import { AppiumClient, type AppiumElementSelector, type AppiumSession } from './appium-client';
import type { VinClubActionAdapter } from './vinclub-action-adapter';
import type { WorkflowStep } from './workflow-runner';
import type { WdaAttach, WdaTarget } from './wda-supervisor';

export const appiumCapabilities = ['launchApp', 'ensureHome', 'waitForText', 'tapText', 'inputText', 'assertText', 'screenshot'] as const;
// wdaBundleId is set once "Chuẩn bị WDA" installed WDA for go-ios (iOS < 17); those devices never let Appium launch WDA.
export type AppiumDevice = { udid: string; bundleId: string; wdaLocalPort: number; connectionType?: 'usb' | 'ip'; ipAddress?: string | null; wdaBundleId?: string | null; wdaExpiresAt?: string | null };
export type WdaLauncher = { ensure(target: WdaTarget): Promise<WdaAttach>; stop(udid: string): void; stopAll(): void };

export class AppiumAutomationEngine {
  readonly capabilities: readonly string[];
  constructor(private readonly client = new AppiumClient(), private readonly vinClubAdapter?: VinClubActionAdapter, private readonly wda?: WdaLauncher) { this.capabilities = vinClubAdapter ? [...appiumCapabilities, 'selectDate', 'selectGuests'] : appiumCapabilities; }
  private readonly warm = new Map<string, AppiumSession>();
  // A restarted go-ios WDA no longer knows the sessions attached to the previous one.
  private readonly wdaGenerations = new Map<string, number>();
  // Devices start their sessions one at a time: concurrent WDA launches share Xcode's DerivedData and can fail on its build lock.
  // Only session creation (~4s) is serialised; runs on warm sessions proceed in parallel.
  private creating: Promise<unknown> = Promise.resolve();
  // An `until` result is handed to the next step, which usually acts on it, instead of being looked up again (~0.25s).
  private readonly handoffs = new Map<string, Handoff>();
  private readonly carried = new Map<string, Handoff>();
  health() { return this.client.health(); }
  // Starting a session costs ~4s (WDA handshake + app launch); a kept session only needs the app restarted.
  // restartApp=false keeps the current screen (UI tree capture, health check).
  async acquireSession(device: AppiumDevice, options: { restartApp?: boolean } = {}) {
    const restartApp = options.restartApp ?? true;
    const wda = await this.attachWda(device);
    const cached = this.warm.get(device.udid);
    const sameWda = wda?.generation === undefined || this.wdaGenerations.get(device.udid) === wda.generation;
    if (cached && sameWda && cached.bundleId === device.bundleId && await this.client.isAlive(cached.id)) { if (restartApp) await this.client.restartApp(cached); return cached; }
    this.warm.delete(device.udid);
    if (cached) await this.client.deleteSession(cached.id).catch(() => undefined);
    const create = this.creating.then(() => this.client.createSession(device.udid, device.bundleId, device.wdaLocalPort, { noReset: !restartApp, webDriverAgentUrl: wda?.url, platformVersion: wda?.platformVersion }));
    this.creating = create.catch(() => undefined);
    const session = await create;
    // Sessions attached to a running WDA never reset the app on start, so a run restarts it through WDA like a warm session.
    if (wda && restartApp) await this.client.restartApp(session);
    this.warm.set(device.udid, session);
    if (wda?.generation !== undefined) this.wdaGenerations.set(device.udid, wda.generation);
    return session;
  }
  // go-ios devices get their WDA started (or restarted) here; plain IP devices must already run one.
  private async attachWda(device: AppiumDevice): Promise<{ url: string; platformVersion?: string; generation?: number } | undefined> {
    if (device.wdaBundleId && this.wda) {
      if (device.wdaExpiresAt && Date.parse(device.wdaExpiresAt) <= Date.now()) throw new Error(`Profile WDA đã hết hạn ngày ${new Date(device.wdaExpiresAt).toLocaleString('vi-VN')}. Bấm "Chuẩn bị WDA" để ký lại.`);
      return this.wda.ensure({ udid: device.udid, wdaBundleId: device.wdaBundleId, connectionType: device.connectionType, ipAddress: device.ipAddress, wdaLocalPort: device.wdaLocalPort });
    }
    const ip = device.connectionType === 'ip' ? device.ipAddress : null;
    if (!ip) return undefined;
    const url = `http://${ip}:${device.wdaLocalPort}`; const status = await this.client.wdaStatus(ip, device.wdaLocalPort);
    if (!status) throw new Error(`Không kết nối được WDA tại ${url}. Mở WebDriverAgent trên iPhone và kiểm tra Mac cùng mạng với máy.`);
    return { url, platformVersion: status.platformVersion };
  }
  // A newly installed WDA replaces the running one: drop its session and runner so the next use starts fresh.
  async forgetDevice(udid: string) {
    const cached = this.warm.get(udid); this.warm.delete(udid); this.wdaGenerations.delete(udid); this.wda?.stop(udid);
    if (cached) await this.client.deleteSession(cached.id).catch(() => undefined);
  }
  async discardSession(session: AppiumSession) {
    for (const [udid, cached] of this.warm) if (cached.id === session.id) this.warm.delete(udid);
    await this.client.deleteSession(session.id).catch(() => undefined);
  }
  async closeAll() { const sessions = [...this.warm.values()]; this.warm.clear(); await Promise.all(sessions.map((session) => this.client.deleteSession(session.id).catch(() => undefined))); this.wda?.stopAll(); }
  async captureUiHierarchy(device: AppiumDevice) { const session = await this.acquireSession(device, { restartApp: false }); return this.client.getPageSource(session.id); }
  async execute(session: AppiumSession, step: WorkflowStep, variables: Record<string, unknown>) {
    const sessionId = session.id;
    // Only the step right after the `until` may reuse its element.
    const handoff = this.handoffs.get(sessionId); this.handoffs.delete(sessionId);
    if (handoff) this.carried.set(sessionId, handoff);
    try { return await this.run(session, step, variables); } finally { this.carried.delete(sessionId); }
  }
  private async run(session: AppiumSession, step: WorkflowStep, variables: Record<string, unknown>) {
    const sessionId = session.id;
    switch (step.type) {
      case 'launchApp': return this.client.launch(session);
      case 'ensureHome': return this.ensureHome(sessionId, step.timeoutMs ?? 30_000);
      case 'waitForText': return this.locate(sessionId, step, variables);
      case 'tapText': return step.until ? this.tapUntil(sessionId, step, variables) : this.tapOnce(sessionId, step, variables);
      case 'inputText': { const target = await this.locate(sessionId, { ...step, text: step.target }, variables); await this.client.clearElement(sessionId, target); return this.client.typeInto(sessionId, target, interpolate(step.value, variables)); }
      case 'assertText': { await this.waitFor(sessionId, selector(step.text, variables, step), step.timeoutMs ?? 10_000); return; }
      case 'selectDate': case 'selectGuests': if (!this.vinClubAdapter) throw new Error(`${step.type} cần selector profile WDA trước khi chạy live.`); return this.vinClubAdapter.execute(session, step, variables);
      case 'screenshot': return this.client.screenshot(sessionId);
      case 'stop': return;
    }
  }
  screenshot(session: AppiumSession) { return this.client.screenshot(session.id); }
  pageSource(session: AppiumSession) { return this.client.getPageSource(session.id); }
  private async tapOnce(sessionId: string, step: WorkflowStep, variables: Record<string, unknown>, settle = false) {
    // During a push both screens are in the tree; an element from the outgoing screen goes stale, so look it up again.
    for (let attempt = 0; ; attempt += 1) {
      const element = await this.locate(sessionId, step, variables);
      try { if (settle) await this.waitUntilStill(sessionId, element); return await (step.tapCenter ? this.client.tapCenter(sessionId, element) : this.client.tap(sessionId, element)); }
      catch (error) { if (attempt >= 2 || !isStale(error)) throw error; }
    }
  }
  // Without idle waits a tap landing mid-transition is dropped, so confirm the expected result and tap again if it never shows.
  private async tapUntil(sessionId: string, step: WorkflowStep, variables: Record<string, unknown>) {
    // `until` is an xpath (`/…`), an iOS predicate (`… == …`, cheaper than xpath) or a visible text.
    const until = interpolate(step.until, variables); const expected: AppiumElementSelector = until.startsWith('/') ? { xpath: until } : until.includes(' == ') ? { predicate: until } : { text: until };
    // Toggles (e.g. the terms checkbox, which the app remembers per account) must not be tapped when already in the target state.
    // The state is checked first: when it already holds (the usual case), the toggle is never looked up.
    if (step.skipIfUntil) {
      const target = selector(step.text, variables, step); const started = Date.now();
      for (;;) {
        try { return this.handOver(sessionId, expected, await this.client.find(sessionId, expected)); } catch { /* Not in the target state, or the page is still loading. */ }
        if (await this.client.find(sessionId, target).then(() => true, () => false)) break;
        if (Date.now() - started > (step.timeoutMs ?? 10_000)) throw new Error(`Không tìm thấy selector ${JSON.stringify(target)}.`);
        await sleep(POLL_MS);
      }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // On retries the target may be gone because a slow first tap did land; fall through to the result check then.
      try { await this.tapOnce(sessionId, attempt ? { ...step, timeoutMs: 3_000 } : step, variables, attempt === 0 && step.settle); } catch (error) { if (!attempt) throw error; }
      try { return this.handOver(sessionId, expected, await this.waitFor(sessionId, expected, attempt ? 4_000 : 2_000)); } catch { /* Tap dropped; retry. */ }
    }
    throw new Error(`Đã chạm 3 lần nhưng không thấy ${JSON.stringify(expected)}.`);
  }
  private handOver(sessionId: string, expected: AppiumElementSelector, element: unknown) { this.handoffs.set(sessionId, { key: JSON.stringify(expected), element }); return element; }
  // `settle` steps follow a transition where a tap on the still-sliding target gets dropped (~2s to detect and retry).
  private async waitUntilStill(sessionId: string, element: unknown) {
    let previous = await this.client.rect(sessionId, element);
    for (let check = 0; check < 10; check += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = await this.client.rect(sessionId, element);
      if (current.x === previous.x && current.y === previous.y) return;
      previous = current;
    }
  }
  private async locate(sessionId: string, step: WorkflowStep, variables: Record<string, unknown>) {
    const target = selector(step.text, variables, step); const timeoutMs = step.timeoutMs ?? 10_000;
    const carried = this.carried.get(sessionId); this.carried.delete(sessionId);
    if (carried?.key === JSON.stringify(target)) return carried.element;
    return step.scrollContainer ? this.scrollUntilVisible(sessionId, target, { xpath: interpolate(step.scrollContainer, variables) }, timeoutMs) : this.waitFor(sessionId, target, timeoutMs);
  }
  // Lists render lazily and may hide rows below the fold, so scroll the container about half a page (finger travel plus momentum) at a time until the target is visible.
  private async scrollUntilVisible(sessionId: string, value: AppiumElementSelector, container: AppiumElementSelector, timeoutMs: number) {
    const started = Date.now(); let scrolled = false;
    while (Date.now() - started < timeoutMs) {
      // After a drag the list coasts, and a tap on a moving list only stops it, so wait for the row to be still.
      try { const element = await this.client.find(sessionId, value); if (await this.client.attribute(sessionId, element, 'visible') === 'true') { if (scrolled) await this.waitUntilStill(sessionId, element); return element; } } catch { /* Not rendered yet. */ }
      try { await this.client.scroll(sessionId, 'down', await this.client.find(sessionId, container), 0.3); scrolled = true; } catch { /* Container still loading. */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Không tìm thấy selector hiển thị ${JSON.stringify(value)} sau ${timeoutMs}ms.`);
  }
  private async waitFor(sessionId: string, value: AppiumElementSelector, timeoutMs: number) { const started = Date.now(); while (Date.now() - started < timeoutMs) { try { return await this.client.find(sessionId, value); } catch { await sleep(POLL_MS); } } throw new Error(`Không tìm thấy selector ${JSON.stringify(value)} sau ${timeoutMs}ms.`); }
  // Login is not automated: the iPhone must already hold a MyVinpearl session for the account.
  private async ensureHome(sessionId: string, timeoutMs: number) {
    try { await this.waitFor(sessionId, { text: 'Khách sạn' }, timeoutMs); }
    catch {
      const onLogin = await this.client.find(sessionId, { xpath: "//XCUIElementTypeButton[@name='Đăng nhập ngay']" }).then(() => true, () => false);
      throw new Error(onLogin ? 'MyVinpearl chưa đăng nhập trên iPhone này. Hãy đăng nhập thủ công trên máy rồi chạy lại.' : `Không thấy trang chủ MyVinpearl sau ${timeoutMs}ms.`);
    }
  }
}
type Handoff = { key: string; element: unknown };
// A miss already costs a ~0.2s lookup, so the pause between polls stays short.
const POLL_MS = 100;
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function isStale(error: unknown) { return error instanceof Error && /not present in the current view|stale/i.test(error.message); }
function interpolate(value: unknown, variables: Record<string, unknown>) { return String(value ?? '').replace(/\{\{([\w.-]+)\}\}/g, (_match, key: string) => { const variable = variables[key]; return variable && typeof variable === 'object' && 'secret' in variable ? '' : String(variable ?? ''); }); }
function selector(value: unknown, variables: Record<string, unknown>, step: WorkflowStep): AppiumElementSelector { if (step.accessibilityId) return { accessibilityId: interpolate(step.accessibilityId, variables) }; if (step.xpath) return { xpath: interpolate(step.xpath, variables) }; if (step.predicate) return { predicate: interpolate(step.predicate, variables) }; if (step.classChain) return { classChain: interpolate(step.classChain, variables) }; return { text: interpolate(value, variables) }; }
