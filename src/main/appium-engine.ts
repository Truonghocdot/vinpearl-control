import { AppiumClient, type AppiumElementSelector, type AppiumSession } from './appium-client';
import type { VinClubActionAdapter } from './vinclub-action-adapter';
import type { WorkflowStep } from './workflow-runner';

export const appiumCapabilities = ['launchApp', 'waitForText', 'tapText', 'inputText', 'assertText', 'screenshot'] as const;
export type AppiumDevice = { udid: string; bundleId: string; wdaLocalPort: number };

export class AppiumAutomationEngine {
  readonly capabilities: readonly string[];
  constructor(private readonly client = new AppiumClient(), private readonly vinClubAdapter?: VinClubActionAdapter) { this.capabilities = vinClubAdapter ? [...appiumCapabilities, 'selectDate', 'selectGuests'] : appiumCapabilities; }
  health() { return this.client.health(); }
  createSession(device: AppiumDevice) { return this.client.createSession(device.udid, device.bundleId, device.wdaLocalPort); }
  async execute(session: AppiumSession, step: WorkflowStep, variables: Record<string, unknown>) {
    const sessionId = session.id;
    switch (step.type) {
      case 'launchApp': return this.client.launch(session);
      case 'waitForText': return this.waitFor(sessionId, selector(step.text, variables, step.accessibilityId), step.timeoutMs ?? 10_000);
      case 'tapText': return this.client.click(sessionId, selector(step.text, variables, step.accessibilityId));
      case 'inputText': return this.client.input(sessionId, selector(step.target, variables, step.accessibilityId), interpolate(step.value, variables));
      case 'assertText': { await this.waitFor(sessionId, selector(step.text, variables, step.accessibilityId), step.timeoutMs ?? 10_000); return; }
      case 'selectDate': case 'selectGuests': if (!this.vinClubAdapter) throw new Error(`${step.type} cần selector profile WDA trước khi chạy live.`); return this.vinClubAdapter.execute(session, step, variables);
      case 'screenshot': return this.client.screenshot(sessionId);
      case 'stop': return;
    }
  }
  screenshot(session: AppiumSession) { return this.client.screenshot(session.id); }
  close(session: AppiumSession) { return this.client.deleteSession(session.id); }
  private async waitFor(sessionId: string, value: AppiumElementSelector, timeoutMs: number) { const started = Date.now(); while (Date.now() - started < timeoutMs) { try { return await this.client.find(sessionId, value); } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } } throw new Error(`Không tìm thấy selector sau ${timeoutMs}ms.`); }
}
function interpolate(value: unknown, variables: Record<string, unknown>) { return String(value ?? '').replace(/\{\{([\w.-]+)\}\}/g, (_match, key: string) => { const variable = variables[key]; return variable && typeof variable === 'object' && 'secret' in variable ? '' : String(variable ?? ''); }); }
function selector(value: unknown, variables: Record<string, unknown>, accessibilityId?: string): AppiumElementSelector { return accessibilityId ? { accessibilityId: interpolate(accessibilityId, variables) } : { text: interpolate(value, variables) }; }
