import http from 'node:http';

export type AppiumElementSelector = { accessibilityId?: string; text?: string };
export type AppiumSession = { id: string; bundleId: string; capabilities: Record<string, unknown> };

export type AppiumClientOptions = {
  host?: string;
  port?: number;
  timeoutMs?: number;
  request?: typeof requestJson;
};

export class AppiumClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly request: typeof requestJson;

  constructor(options: AppiumClientOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 4723;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.request = options.request ?? requestJson;
  }

  async health() {
    const response = await this.request(this.host, this.port, 'GET', '/status', undefined, this.timeoutMs);
    return Boolean((response.value as { ready?: boolean } | undefined)?.ready ?? response.ready);
  }

  async createSession(udid: string, bundleId: string, wdaLocalPort: number): Promise<AppiumSession> {
    const response = await this.request(this.host, this.port, 'POST', '/session', {
      capabilities: { alwaysMatch: { platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid, 'appium:bundleId': bundleId, 'appium:wdaLocalPort': wdaLocalPort, 'appium:newCommandTimeout': 60 } },
    }, this.timeoutMs);
    const sessionId = String(response.sessionId ?? response.value?.sessionId ?? '');
    if (!sessionId) throw new Error('Appium không trả về session id.');
    return { id: sessionId, bundleId, capabilities: response.value ?? {} };
  }

  async deleteSession(sessionId: string) { await this.request(this.host, this.port, 'DELETE', `/session/${encodeURIComponent(sessionId)}`, undefined, this.timeoutMs); }
  async launch(session: AppiumSession) { return this.post(session.id, '/appium/device/activate_app', { bundleId: session.bundleId }); }
  async screenshot(sessionId: string) { return String((await this.get(sessionId, '/screenshot')).value ?? ''); }
  async find(sessionId: string, selector: AppiumElementSelector) {
    if (selector.accessibilityId) return this.post(sessionId, '/element', { using: 'accessibility id', value: selector.accessibilityId });
    if (!selector.text) throw new Error('Selector text hoặc accessibilityId là bắt buộc.');
    return this.post(sessionId, '/element', { using: '-ios predicate string', value: `label == '${escapePredicate(selector.text)}' OR name == '${escapePredicate(selector.text)}'` });
  }
  async click(sessionId: string, selector: AppiumElementSelector) { const element = await this.find(sessionId, selector); return this.post(sessionId, `/element/${elementId(element)}/click`, {}); }
  async input(sessionId: string, selector: AppiumElementSelector, value: string) { const element = await this.find(sessionId, selector); return this.post(sessionId, `/element/${elementId(element)}/value`, { text: value, value: Array.from(value) }); }
  async getPageSource(sessionId: string) { return String((await this.get(sessionId, '/source')).value ?? ''); }
  private get(sessionId: string, route: string) { return this.request(this.host, this.port, 'GET', `/session/${encodeURIComponent(sessionId)}${route}`, undefined, this.timeoutMs); }
  private post(sessionId: string, route: string, body: unknown) { return this.request(this.host, this.port, 'POST', `/session/${encodeURIComponent(sessionId)}${route}`, body, this.timeoutMs); }
}

function escapePredicate(value: string) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function elementId(response: any) { const id = response.value?.ELEMENT ?? response.value?.['element-6066-11e4-a52e-4f735466cecf']; if (!id) throw new Error('Appium không trả về element id.'); return encodeURIComponent(String(id)); }

export function requestJson(host: string, port: number, method: string, route: string, body?: unknown, timeoutMs = 15_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request({ host, port, method, path: route, timeout: timeoutMs, headers: { 'content-type': 'application/json', ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) } }, (response) => {
      let data = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { data += chunk; });
      response.once('end', () => { let parsed: any = {}; try { parsed = data ? JSON.parse(data) : {}; } catch { reject(new Error(`Appium trả response không hợp lệ (${response.statusCode}).`)); return; } if ((response.statusCode ?? 500) >= 400 || parsed.value?.error) { reject(new Error(parsed.value?.message ?? `Appium HTTP ${response.statusCode}`)); return; } resolve(parsed); });
    });
    request.once('timeout', () => request.destroy(new Error(`Appium timeout sau ${timeoutMs}ms.`)));
    request.once('error', reject); if (payload) request.write(payload); request.end();
  });
}
