import { AppiumAutomationEngine } from './appium-engine';
import type { AppiumSession } from './appium-client';
import { getAccount, getCampaign, getDevice, saveJobRun, saveUiHierarchy, setDeviceStatus, updateDeviceHealth, validateCampaignInputs, type Campaign, type Device, type UiHierarchyCapture } from './database';
import type { CredentialStore } from './keychain';
import { vinClubWorkflow } from './workflow-template';
import { runWorkflowLive, type WorkflowDefinition, type WorkflowRun } from './workflow-runner';

export type DeviceHealth = { appiumReady: boolean; deviceReady: boolean; capabilities: string[]; message?: string };

export class JobService {
  private readonly activeByDevice = new Map<number, { controller: AbortController; session?: AppiumSession }>();
  private activeCount = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly engine: AppiumAutomationEngine, private readonly credentials: CredentialStore, private readonly concurrency = 2) {}

  async checkDevice(deviceId: number): Promise<DeviceHealth> {
    if (this.activeByDevice.has(deviceId)) throw new Error('Không thể health check khi thiết bị đang có job chạy.');
    const device = getDevice(deviceId);
    try { const appiumReady = await this.engine.health(); if (!appiumReady) throw new Error('Appium local chưa sẵn sàng.'); const session = await this.engine.createSession(device); await this.engine.close(session); updateDeviceHealth(device.id, { status: 'ready', pairingStatus: 'paired', capabilities: [...this.engine.capabilities], lastError: null }); return { appiumReady: true, deviceReady: true, capabilities: [...this.engine.capabilities] }; } catch (error) { const message = error instanceof Error ? error.message : 'Không thể kiểm tra thiết bị.'; updateDeviceHealth(device.id, { status: 'error', pairingStatus: 'unpaired', capabilities: [], lastError: message }); return { appiumReady: false, deviceReady: false, capabilities: [], message }; }
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
    campaign.targets.forEach((target) => {
      const device = getDevice(target.deviceId);
      const account = getAccount(target.accountId);
      if (account.status !== 'active') throw new Error(`Tài khoản ${account.displayName} đang bị vô hiệu hóa.`);
      this.assertCapabilities(device, vinClubWorkflow);
    });
    return Promise.all(campaign.targets.map((target) => this.run(campaign, target.deviceId, target.accountId)));
  }

  async run(campaign: Campaign, deviceId: number, accountId: number): Promise<WorkflowRun> {
    const device = getDevice(deviceId); const account = getAccount(accountId); const workflow = vinClubWorkflow;
    if (account.status !== 'active') throw new Error('Tài khoản đang bị vô hiệu hóa.');
    if (this.activeByDevice.has(deviceId)) throw new Error('Thiết bị đang có job chạy.');
    this.assertCapabilities(device, workflow);
    const controller = new AbortController(); const active: { controller: AbortController; session?: AppiumSession } = { controller }; this.activeByDevice.set(deviceId, active);
    let sessionId: string | undefined; let session: AppiumSession | undefined; let acquired = false;
    try {
      await this.acquire(); acquired = true;
      if (controller.signal.aborted) return this.saveEmptyRun(campaign, deviceId, accountId, 'cancelled');
      setDeviceStatus(deviceId, 'busy');
      const runtimeWorkflow = await this.resolveRuntimeWorkflow(workflow, campaign, account);
      session = await this.engine.createSession(device); active.session = session; sessionId = session.id;
      const run = await runWorkflowLive(runtimeWorkflow, this.engine, session, { deviceId, accountId, campaignId: campaign.id, signal: controller.signal, captureEveryStep: campaign.status === 'draft' });
      const stored = saveJobRun(run, sessionId);
      setDeviceStatus(deviceId, run.status === 'failed' ? 'error' : 'ready', run.status === 'failed' ? lastMessage(run) : null);
      return stored;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể khởi tạo Appium session.';
      setDeviceStatus(deviceId, 'error', message);
      return this.saveEmptyRun(campaign, deviceId, accountId, controller.signal.aborted ? 'cancelled' : 'failed', sessionId);
    } finally { if (session) await this.engine.close(session).catch(() => undefined); this.activeByDevice.delete(deviceId); if (acquired) this.release(); }
  }

  cancel(deviceId: number) { const active = this.activeByDevice.get(deviceId); if (!active) return false; active.controller.abort(); if (active.session) void this.engine.close(active.session).catch(() => undefined); return true; }

  private saveEmptyRun(campaign: Campaign, deviceId: number, accountId: number, status: 'failed' | 'cancelled', sessionId?: string) { const now = new Date().toISOString(); return saveJobRun({ workflowId: vinClubWorkflow.id, campaignId: campaign.id, deviceId, accountId, engine: 'appium', status, startedAt: now, finishedAt: now, logs: [] }, sessionId); }
  private assertDraftTestSafeStop() { const finalStep = vinClubWorkflow.steps.at(-1); const confirmationStep = vinClubWorkflow.steps.at(-2); if (finalStep?.type !== 'stop' || confirmationStep?.type !== 'waitForText' || confirmationStep.text !== 'Xác nhận thanh toán') throw new Error('Kịch bản test không có điểm dừng an toàn tại màn xác nhận thanh toán.'); }
  private assertCapabilities(device: Device, workflow: WorkflowDefinition) { if (device.status !== 'ready' || device.pairingStatus !== 'paired') throw new Error('Thiết bị chưa qua Appium health check.'); const unsupported = workflow.steps.find((step) => step.type !== 'stop' && !device.capabilities.includes(step.type)); if (unsupported) throw new Error(`Thiết bị chưa có capability ${unsupported.type}. Hoàn tất WDA selector profile trước khi chạy live.`); }
  private async resolveRuntimeWorkflow(workflow: WorkflowDefinition, campaign: Campaign, account: ReturnType<typeof getAccount>): Promise<WorkflowDefinition> { const credential = await this.credentials.get(account.credentialRef); const variables = { ...workflow.variables, ...campaign.inputs, username: account.username, password: credential.password }; return { ...workflow, variables }; }
  private async acquire() { if (this.activeCount < this.concurrency) { this.activeCount += 1; return; } await new Promise<void>((resolve) => this.waiters.push(resolve)); this.activeCount += 1; }
  private release() { this.activeCount -= 1; this.waiters.shift()?.(); }
}

function lastMessage(run: Omit<WorkflowRun, 'id'>) { return run.logs.at(-1)?.message ?? 'Kịch bản booking thất bại.'; }
