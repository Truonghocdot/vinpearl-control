import { AppiumClient, type AppiumElementSelector, type AppiumSession } from './appium-client';
import type { VinClubActionAdapter } from './vinclub-action-adapter';
import type { WorkflowStep } from './workflow-runner';

export const appiumCapabilities = ['launchApp', 'ensureHome', 'waitForText', 'tapText', 'inputText', 'assertText', 'screenshot'] as const;
export type AppiumDevice = { udid: string; bundleId: string; wdaLocalPort: number };

export class AppiumAutomationEngine {
  readonly capabilities: readonly string[];
  constructor(private readonly client = new AppiumClient(), private readonly vinClubAdapter?: VinClubActionAdapter) { this.capabilities = vinClubAdapter ? [...appiumCapabilities, 'selectDate', 'selectGuests'] : appiumCapabilities; }
  health() { return this.client.health(); }
  createSession(device: AppiumDevice) { return this.client.createSession(device.udid, device.bundleId, device.wdaLocalPort); }
  async captureUiHierarchy(device: AppiumDevice) { const session = await this.client.createSession(device.udid, device.bundleId, device.wdaLocalPort, { noReset: true }); try { return await this.client.getPageSource(session.id); } finally { await this.close(session).catch(() => undefined); } }
  async execute(session: AppiumSession, step: WorkflowStep, variables: Record<string, unknown>) {
    const sessionId = session.id;
    switch (step.type) {
      case 'launchApp': return this.client.launch(session);
      case 'ensureHome': return this.ensureHome(session, variables, step.timeoutMs ?? 30_000);
      case 'waitForText': return this.locate(sessionId, step, variables);
      case 'tapText': return step.until ? this.tapUntil(sessionId, step, variables) : this.tapOnce(sessionId, step, variables);
      case 'inputText': { const target = selector(step.target, variables, step); await this.client.clear(sessionId, target); return this.client.input(sessionId, target, interpolate(step.value, variables)); }
      case 'assertText': { await this.waitFor(sessionId, selector(step.text, variables, step), step.timeoutMs ?? 10_000); return; }
      case 'selectDate': case 'selectGuests': if (!this.vinClubAdapter) throw new Error(`${step.type} cần selector profile WDA trước khi chạy live.`); return this.vinClubAdapter.execute(session, step, variables);
      case 'screenshot': return this.client.screenshot(sessionId);
      case 'stop': return;
    }
  }
  screenshot(session: AppiumSession) { return this.client.screenshot(session.id); }
  pageSource(session: AppiumSession) { return this.client.getPageSource(session.id); }
  close(session: AppiumSession) { return this.client.deleteSession(session.id); }
  private async tapOnce(sessionId: string, step: WorkflowStep, variables: Record<string, unknown>) { const element = await this.locate(sessionId, step, variables); return step.tapCenter ? this.client.tapCenter(sessionId, element) : this.client.tap(sessionId, element); }
  // Without idle waits a tap landing mid-transition is dropped, so confirm the expected result and tap again if it never shows.
  private async tapUntil(sessionId: string, step: WorkflowStep, variables: Record<string, unknown>) {
    const until = interpolate(step.until, variables); const expected: AppiumElementSelector = until.startsWith('/') ? { xpath: until } : { text: until };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // On retries the target may be gone because a slow first tap did land; fall through to the result check then.
      try { await this.tapOnce(sessionId, attempt ? { ...step, timeoutMs: 3_000 } : step, variables); } catch (error) { if (!attempt) throw error; }
      try { return await this.waitFor(sessionId, expected, attempt ? 4_000 : 2_000); } catch { /* Tap dropped; retry. */ }
    }
    throw new Error(`Đã chạm 3 lần nhưng không thấy ${JSON.stringify(expected)}.`);
  }
  private locate(sessionId: string, step: WorkflowStep, variables: Record<string, unknown>) {
    const target = selector(step.text, variables, step); const timeoutMs = step.timeoutMs ?? 10_000;
    return step.scrollContainer ? this.scrollUntilVisible(sessionId, target, { xpath: interpolate(step.scrollContainer, variables) }, timeoutMs) : this.waitFor(sessionId, target, timeoutMs);
  }
  // Lists render lazily and may hide rows below the fold, so scroll the container about half a page (finger travel plus momentum) at a time until the target is visible.
  private async scrollUntilVisible(sessionId: string, value: AppiumElementSelector, container: AppiumElementSelector, timeoutMs: number) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try { const element = await this.client.find(sessionId, value); if (await this.client.attribute(sessionId, element, 'visible') === 'true') return element; } catch { /* Not rendered yet. */ }
      try { await this.client.scroll(sessionId, 'down', await this.client.find(sessionId, container), 0.3); } catch { /* Container still loading. */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Không tìm thấy selector hiển thị ${JSON.stringify(value)} sau ${timeoutMs}ms.`);
  }
  private async waitFor(sessionId: string, value: AppiumElementSelector, timeoutMs: number) { const started = Date.now(); while (Date.now() - started < timeoutMs) { try { return await this.client.find(sessionId, value); } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } } throw new Error(`Không tìm thấy selector ${JSON.stringify(value)} sau ${timeoutMs}ms.`); }
  private async ensureHome(session: AppiumSession, variables: Record<string, unknown>, timeoutMs: number) {
    const home = { text: 'Khách sạn' };
    const loginEmail = { xpath: '//XCUIElementTypeTextField[1]' };
    const authLogin = { xpath: "//XCUIElementTypeButton[@name='Đăng nhập ngay']" };
    const startState = await this.waitForStartState(session.id, home, loginEmail, authLogin, Math.min(timeoutMs, 15_000));
    if (startState === 'home') return;
    if (startState === 'auth') { await this.client.click(session.id, authLogin); await this.waitFor(session.id, loginEmail, 10_000); }
    const username = String(variables.username ?? ''); const password = String(variables.password ?? '');
    if (!username.trim() || !password) throw new Error('Thiếu credential Keychain để đăng nhập MyVinpearl.');
    const passwordField = { xpath: '//XCUIElementTypeSecureTextField[1]' };
    const terms = { xpath: "//XCUIElementTypeOther[XCUIElementTypeTextView[contains(@value, 'Tôi đã đọc và đồng ý')]]//XCUIElementTypeButton[1]" };
    const submit = { xpath: "//XCUIElementTypeButton[@name='Đăng nhập ngay']" };
    await this.client.clear(session.id, loginEmail); await this.client.input(session.id, loginEmail, username);
    await this.client.clear(session.id, passwordField); await this.client.input(session.id, passwordField, password);
    await this.client.click(session.id, terms); await this.client.click(session.id, submit);
    await this.waitFor(session.id, home, Math.max(10_000, timeoutMs - 10_000));
  }
  private async waitForStartState(sessionId: string, home: AppiumElementSelector, login: AppiumElementSelector, auth: AppiumElementSelector, timeoutMs: number): Promise<'home' | 'login' | 'auth'> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try { await this.client.find(sessionId, home); return 'home'; } catch { /* Try next state. */ }
      try { await this.client.find(sessionId, login); return 'login'; } catch { /* Try next state. */ }
      try { await this.client.find(sessionId, auth); return 'auth'; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    throw new Error('Không xác định được màn Home, Login hoặc Auth sau khi mở MyVinpearl.');
  }
}
function interpolate(value: unknown, variables: Record<string, unknown>) { return String(value ?? '').replace(/\{\{([\w.-]+)\}\}/g, (_match, key: string) => { const variable = variables[key]; return variable && typeof variable === 'object' && 'secret' in variable ? '' : String(variable ?? ''); }); }
function selector(value: unknown, variables: Record<string, unknown>, step: WorkflowStep): AppiumElementSelector { if (step.accessibilityId) return { accessibilityId: interpolate(step.accessibilityId, variables) }; if (step.xpath) return { xpath: interpolate(step.xpath, variables) }; if (step.predicate) return { predicate: interpolate(step.predicate, variables) }; if (step.classChain) return { classChain: interpolate(step.classChain, variables) }; return { text: interpolate(value, variables) }; }
