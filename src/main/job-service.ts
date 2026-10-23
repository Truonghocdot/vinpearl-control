import { AppiumAutomationEngine } from './appium-engine';
import type { AppiumSession } from './appium-client';
import { getCampaign, getDevice, saveJobRun, saveUiHierarchy, setDeviceStatus, updateDeviceHealth, updateDeviceWda, validateCampaignInputs, type Campaign, type Device, type UiHierarchyCapture } from './database';
import { usesGoIos } from './go-ios';
import type { WdaPreparation } from './wda-preparer';
import { vinClubWorkflow } from './workflow-template';
import { runWorkflowLive, type WorkflowDefinition, type WorkflowRun } from './workflow-runner';

export type DeviceHealth = { appiumReady: boolean; deviceReady: boolean; capabilities: string[]; message?: string };
export type WdaPreparerLike = { iosVersion(udid: string): Promise<string>; prepare(device: { udid: string }): Promise<WdaPreparation> };
// A free-team profile lasts 7 days: re-sign during the health check once less than a day is left.
const AUTO_RESIGN_MS = 86_400_000;

export class JobService {
  private readonly activeByDevice = new Map<number, { controller: AbortController; session?: AppiumSession }>();
  private activeCount = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly engine: AppiumAutomationEngine, private readonly concurrency = 4, private readonly wdaPreparer?: WdaPreparerLike) {}

  // Builds, patches and installs WDA (go-ios devices), then drops the running WDA so the next check uses the new build.
  async prepareWda(deviceId: number): Promise<{ device: Device; message: string }> {
    if (!this.wdaPreparer) throw new Error('Chưa cấu hình chuẩn bị WDA.');
    if (this.activeByDevice.has(deviceId)) throw new Error('Không thể chuẩn bị WDA khi thiết bị đang có job chạy.');
    const device = getDevice(deviceId); const controller = new AbortController();
    this.activeByDevice.set(deviceId, { controller });
    try {
      const prepared = await this.prepareDevice(device, this.wdaPreparer);
      // The device must pass a health check against the new WDA before it runs again.
      return { device: setDeviceStatus(deviceId, 'unknown'), message: prepared.message };
    } catch (error) { setDeviceStatus(deviceId, 'error', error instanceof Error ? error.message : 'Không thể chuẩn bị WDA.'); throw error; }
    finally { this.activeByDevice.delete(deviceId); }
  }

  async checkDevice(deviceId: number): Promise<DeviceHealth> {
    if (this.activeByDevice.has(deviceId)) throw new Error('Không thể health check khi thiết bị đang có job chạy.');
    let device = getDevice(deviceId);
    try { const appiumReady = await this.engine.health(); if (!appiumReady) throw new Error('Appium local chưa sẵn sàng.'); device = await this.autoPrepareWda(device); await this.engine.acquireSession(device, { restartApp: false }); updateDeviceHealth(device.id, { status: 'ready', pairingStatus: 'paired', capabilities: [...this.engine.capabilities], lastError: null }); return { appiumReady: true, deviceReady: true, capabilities: [...this.engine.capabilities] }; } catch (error) { const message = error instanceof Error ? error.message : 'Không thể kiểm tra thiết bị.'; updateDeviceHealth(device.id, { status: 'error', pairingStatus: 'unpaired', capabilities: [], lastError: message }); return { appiumReady: false, deviceReady: false, capabilities: [], message }; }
  }

  private async prepareDevice(device: Device, preparer: WdaPreparerLike) {
    await this.engine.forgetDevice(device.udid);
    const prepared = await preparer.prepare(device);
    return { device: updateDeviceWda(device.id, { iosVersion: prepared.iosVersion, wdaBundleId: prepared.wdaBundleId, wdaExpiresAt: prepared.wdaExpiresAt }), message: prepared.message };
  }

  // Plugging an iPhone in and pressing "Kiểm tra" is enough: the first check reads its iOS version and, for iOS < 17,
  // builds, signs and installs WDA; later checks re-sign a profile about to expire. Devices go-ios cannot see (e.g. an
  // iOS 17+ phone paired only through Xcode) keep Appium's own WDA launch.
  private async autoPrepareWda(device: Device): Promise<Device> {
    if (!this.wdaPreparer) return device;
    const expiresAt = device.wdaBundleId && device.wdaExpiresAt ? Date.parse(device.wdaExpiresAt) : null;
    if (device.iosVersion !== null && (expiresAt === null || expiresAt - Date.now() > AUTO_RESIGN_MS)) return device;
    const iosVersion = await this.wdaPreparer.iosVersion(device.udid).catch(() => null);
    if (iosVersion === null) { if (expiresAt !== null && expiresAt <= Date.now()) throw new Error('Profile WDA đã hết hạn và go-ios không thấy iPhone để ký lại. Cắm cáp, mở khóa máy rồi kiểm tra lại.'); return device; }
    if (!usesGoIos(iosVersion)) return updateDeviceWda(device.id, { iosVersion, wdaBundleId: null, wdaExpiresAt: null });
    // A re-sign that fails while the current profile is still valid must not take a working device down.
    try { return (await this.prepareDevice(device, this.wdaPreparer)).device; } catch (error) { if (expiresAt !== null && expiresAt > Date.now()) return device; throw error; }
  }

  async captureUiHierarchy(deviceId: number): Promise<UiHierarchyCapture> {
    if (this.activeByDevice.has(deviceId)) throw new Error('Không thể lấy hierarchy khi thiết bị đang có job chạy.');
    const device = getDevice(deviceId);
    const controller = new AbortController();
    this.activeByDevice.set(deviceId, { controller });
    let acquired = false;
    try { await this.acquire(); acquired = true; if (controller.signal.aborted) throw new Error('Đã hủy lấy UI hierarchy.'); const source = await this.engine.captureUiHierarchy(device); return saveUiHierarchy(deviceId, source); }
    catch (error) { const message = error instanceof Error ? error.message : 'Không thể lấy UI hierarchy.'; setDeviceStatus(deviceId, 'error', message); throw error; }
    finally { this.activeByDevice.delete(deviceId); if (acquired) this.release(); }
  }

  async runCampaign(campaignId: number): Promise<WorkflowRun[]> {
    const campaign = getCampaign(campaignId);
    if (campaign.status === 'archived') throw new Error('Campaign đã lưu trữ không thể chạy.');
    if (campaign.status === 'draft') this.assertDraftTestSafeStop();
    const inputErrors = validateCampaignInputs(campaign.inputs);
    if (inputErrors.length) throw new Error(inputErrors.join(' '));
    campaign.targets.forEach((target) => this.assertCapabilities(getDevice(target.deviceId), vinClubWorkflow));
    return Promise.all(campaign.targets.map((target) => this.run(campaign, target.deviceId)));
  }

  // The run uses whichever MyVinpearl account is logged in on the iPhone.
  async run(campaign: Campaign, deviceId: number): Promise<WorkflowRun> {
    const device = getDevice(deviceId); const workflow = vinClubWorkflow;
    if (this.activeByDevice.has(deviceId)) throw new Error('Thiết bị đang có job chạy.');
    this.assertCapabilities(device, workflow);
    const controller = new AbortController(); const active: { controller: AbortController; session?: AppiumSession } = { controller }; this.activeByDevice.set(deviceId, active);
    let sessionId: string | undefined; let session: AppiumSession | undefined; let acquired = false;
    try {
      await this.acquire(); acquired = true;
      if (controller.signal.aborted) return this.saveEmptyRun(campaign, deviceId, 'cancelled');
      setDeviceStatus(deviceId, 'busy');
      // The health check (or the previous run) leaves a warm session; acquiring it restarts the app instead of starting WDA again.
      session = await this.engine.acquireSession(device); active.session = session; sessionId = session.id;
      const run = await runWorkflowLive({ ...workflow, variables: { ...workflow.variables, ...campaign.inputs } }, this.engine, session, { deviceId, campaignId: campaign.id, signal: controller.signal, captureMilestones: campaign.status === 'draft' });
      const stored = saveJobRun(run, sessionId);
      setDeviceStatus(deviceId, run.status === 'failed' ? 'error' : 'ready', run.status === 'failed' ? lastMessage(run) : null);
      return stored;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể khởi tạo Appium session.';
      setDeviceStatus(deviceId, 'error', message);
      return this.saveEmptyRun(campaign, deviceId, controller.signal.aborted ? 'cancelled' : 'failed', sessionId);
    } finally { this.activeByDevice.delete(deviceId); if (acquired) this.release(); }
  }

  cancel(deviceId: number) { const active = this.activeByDevice.get(deviceId); if (!active) return false; active.controller.abort(); if (active.session) void this.engine.discardSession(active.session); return true; }

  private saveEmptyRun(campaign: Campaign, deviceId: number, status: 'failed' | 'cancelled', sessionId?: string) { const now = new Date().toISOString(); return saveJobRun({ workflowId: vinClubWorkflow.id, campaignId: campaign.id, deviceId, engine: 'appium', status, startedAt: now, finishedAt: now, logs: [] }, sessionId); }
  private assertDraftTestSafeStop() { const finalStep = vinClubWorkflow.steps.at(-1); const confirmationStep = vinClubWorkflow.steps.at(-2); if (finalStep?.type !== 'stop' || confirmationStep?.type !== 'waitForText' || confirmationStep.text !== 'Xác nhận thanh toán') throw new Error('Kịch bản test không có điểm dừng an toàn tại màn xác nhận thanh toán.'); }
  private assertCapabilities(device: Device, workflow: WorkflowDefinition) { if (device.status !== 'ready' || device.pairingStatus !== 'paired') throw new Error('Thiết bị chưa qua Appium health check.'); const unsupported = workflow.steps.find((step) => step.type !== 'stop' && !device.capabilities.includes(step.type)); if (unsupported) throw new Error(`Thiết bị chưa có capability ${unsupported.type}. Hoàn tất WDA selector profile trước khi chạy live.`); }
  private async acquire() { if (this.activeCount < this.concurrency) { this.activeCount += 1; return; } await new Promise<void>((resolve) => this.waiters.push(resolve)); this.activeCount += 1; }
  private release() { this.activeCount -= 1; this.waiters.shift()?.(); }
}

function lastMessage(run: Omit<WorkflowRun, 'id'>) { return run.logs.at(-1)?.message ?? 'Kịch bản booking thất bại.'; }
