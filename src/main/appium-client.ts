import http from 'node:http';

export type AppiumElementSelector = { accessibilityId?: string; text?: string; predicate?: string; classChain?: string; xpath?: string };
export type ElementRect = { x: number; y: number; width: number; height: number };
export type AppiumSession = { id: string; bundleId: string; capabilities: Record<string, unknown> };

export type AppiumClientOptions = {
  host?: string;
  port?: number;
  timeoutMs?: number;
  sessionStartupTimeoutMs?: number;
  xcodeOrgId?: string;
  xcodeSigningId?: string;
  waitForIdleTimeout?: number;
  animationCoolOffTimeout?: number;
  maxTypingFrequency?: number;
  webDriverAgentUrl?: string;
  agent?: http.Agent;
  request?: typeof requestJson;
};

export class AppiumClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly sessionStartupTimeoutMs: number;
  private readonly xcodeOrgId?: string;
  private readonly xcodeSigningId: string;
  private readonly waitForIdleTimeout: number;
  private readonly animationCoolOffTimeout: number;
  private readonly maxTypingFrequency: number;
  private readonly webDriverAgentUrl?: string;
  private readonly agent: http.Agent;
  private readonly request: typeof requestJson;

  constructor(options: AppiumClientOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 4723;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.sessionStartupTimeoutMs = options.sessionStartupTimeoutMs ?? 90_000;
    this.xcodeOrgId = options.xcodeOrgId;
    this.xcodeSigningId = options.xcodeSigningId ?? 'Apple Development';
    // Measured on device: waiting for idle/animations adds ~0.7s per tap and ~2s per drag without making the next screen appear sooner.
    this.waitForIdleTimeout = options.waitForIdleTimeout ?? 0;
    this.animationCoolOffTimeout = options.animationCoolOffTimeout ?? 0;
    this.maxTypingFrequency = options.maxTypingFrequency ?? 60;
    this.webDriverAgentUrl = options.webDriverAgentUrl;
    this.agent = options.agent ?? new http.Agent({ keepAlive: true, maxSockets: 8 });
    this.request = options.request ?? requestJson;
  }

  async health() {
    const response = await this.request(this.host, this.port, 'GET', '/status', undefined, this.timeoutMs, this.agent);
    return Boolean((response.value as { ready?: boolean } | undefined)?.ready ?? response.ready);
  }

  async createSession(udid: string, bundleId: string, wdaLocalPort: number, options: { noReset?: boolean } = {}): Promise<AppiumSession> {
    const alwaysMatch: Record<string, unknown> = {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': udid,
      'appium:bundleId': bundleId,
      'appium:wdaLocalPort': wdaLocalPort,
      'appium:newCommandTimeout': 60,
      'appium:useNewWDA': false,
      'appium:wdaStartupRetries': 1,
      'appium:wdaStartupRetryInterval': 1_000,
      'appium:waitForIdleTimeout': this.waitForIdleTimeout,
      'appium:settings[animationCoolOffTimeout]': this.animationCoolOffTimeout,
      'appium:maxTypingFrequency': this.maxTypingFrequency,
      'appium:shouldUseCompactResponses': true,
      'appium:elementResponseAttributes': 'type,label',
      'appium:showXcodeLog': true,
      // Keep the app on the safe-stop screen for operator review; the next session relaunches it anyway.
      'appium:shouldTerminateApp': false,
    };
    if (options.noReset) alwaysMatch['appium:noReset'] = true;
    if (this.xcodeOrgId) {
      alwaysMatch['appium:xcodeOrgId'] = this.xcodeOrgId;
      alwaysMatch['appium:xcodeSigningId'] = this.xcodeSigningId;
    }
    if (this.webDriverAgentUrl) alwaysMatch['appium:webDriverAgentUrl'] = this.webDriverAgentUrl;
    const response = await this.request(this.host, this.port, 'POST', '/session', {
      capabilities: { alwaysMatch },
    }, this.sessionStartupTimeoutMs, this.agent);
    const sessionId = String(response.sessionId ?? response.value?.sessionId ?? '');
    if (!sessionId) throw new Error('Appium không trả về session id.');
    return { id: sessionId, bundleId, capabilities: response.value ?? {} };
  }

  async deleteSession(sessionId: string) { await this.request(this.host, this.port, 'DELETE', `/session/${encodeURIComponent(sessionId)}`, undefined, this.timeoutMs, this.agent); }
  async launch(session: AppiumSession) { return this.post(session.id, '/appium/device/activate_app', { bundleId: session.bundleId }); }  async screenshot(sessionId: string) { return String((await this.get(sessionId, '/screenshot')).value ?? ''); }
  async find(sessionId: string, selector: AppiumElementSelector) {
    if (selector.accessibilityId) return this.post(sessionId, '/element', { using: 'accessibility id', value: selector.accessibilityId });
    if (selector.predicate) return this.post(sessionId, '/element', { using: '-ios predicate string', value: selector.predicate });
    if (selector.classChain) return this.post(sessionId, '/element', { using: '-ios class chain', value: selector.classChain });
    if (selector.xpath) return this.post(sessionId, '/element', { using: 'xpath', value: selector.xpath });
    if (!selector.text) throw new Error('Selector accessibilityId, text, predicate, classChain hoặc xpath là bắt buộc.');
    return this.post(sessionId, '/element', { using: '-ios predicate string', value: `label == '${escapePredicate(selector.text)}' OR name == '${escapePredicate(selector.text)}'` });
  }
  async findAll(sessionId: string, selector: { predicate: string }) { return (((await this.post(sessionId, '/elements', { using: '-ios predicate string', value: selector.predicate })).value ?? []) as unknown[]).map((element) => ({ value: element })); }
  async click(sessionId: string, selector: AppiumElementSelector) { return this.tap(sessionId, await this.find(sessionId, selector)); }
  async tap(sessionId: string, element: unknown) { return this.post(sessionId, `/element/${elementId(element)}/click`, {}); }
  async input(sessionId: string, selector: AppiumElementSelector, value: string) { const element = await this.find(sessionId, selector); return this.post(sessionId, `/element/${elementId(element)}/value`, { text: value, value: Array.from(value) }); }
  async clear(sessionId: string, selector: AppiumElementSelector) { const element = await this.find(sessionId, selector); return this.post(sessionId, `/element/${elementId(element)}/clear`, {}); }
  async text(sessionId: string, selector: AppiumElementSelector) { const element = await this.find(sessionId, selector); return String((await this.get(sessionId, `/element/${elementId(element)}/text`)).value ?? ''); }
  // A W3C drag inside the container's frame; the pause before lifting cancels momentum so each call moves a predictable distance.
  async scroll(sessionId: string, direction: 'up' | 'down', container?: unknown, distance = 0.6) {
    const rect = container ? await this.rect(sessionId, container) : (await this.get(sessionId, '/window/rect')).value as ElementRect;
    const x = Math.round(rect.x + rect.width / 2); const lower = Math.round(rect.y + rect.height * (0.5 + distance / 2)); const upper = Math.round(rect.y + rect.height * (0.5 - distance / 2));
    const [from, to] = direction === 'down' ? [lower, upper] : [upper, lower];
    return this.post(sessionId, '/actions', { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x, y: from }, { type: 'pointerDown', button: 0 }, { type: 'pointerMove', duration: 250, x, y: to }, { type: 'pause', duration: 150 }, { type: 'pointerUp', button: 0 }] }] });
  }
  // Taps the middle of the element's frame; WDA's element click spends ~2.5s probing icons that are not hittable themselves.
  async tapCenter(sessionId: string, element: unknown) {
    const rect = await this.rect(sessionId, element); const x = Math.round(rect.x + rect.width / 2); const y = Math.round(rect.y + rect.height / 2);
    return this.post(sessionId, '/actions', { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x, y }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 50 }, { type: 'pointerUp', button: 0 }] }] });
  }
  async rect(sessionId: string, element: unknown) { return (await this.get(sessionId, `/element/${elementId(element)}/rect`)).value as ElementRect; }
  async attribute(sessionId: string, element: unknown, name: string) { return String((await this.get(sessionId, `/element/${elementId(element)}/attribute/${encodeURIComponent(name)}`)).value ?? ''); }
  async getPageSource(sessionId: string) { return String((await this.get(sessionId, '/source')).value ?? ''); }
  private get(sessionId: string, route: string) { return this.request(this.host, this.port, 'GET', `/session/${encodeURIComponent(sessionId)}${route}`, undefined, this.timeoutMs, this.agent); }
  private post(sessionId: string, route: string, body: unknown) { return this.request(this.host, this.port, 'POST', `/session/${encodeURIComponent(sessionId)}${route}`, body, this.timeoutMs, this.agent); }
}

function escapePredicate(value: string) { return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function elementId(response: any) { const id = response.value?.ELEMENT ?? response.value?.['element-6066-11e4-a52e-4f735466cecf']; if (!id) throw new Error('Appium không trả về element id.'); return encodeURIComponent(String(id)); }

export function requestJson(host: string, port: number, method: string, route: string, body?: unknown, timeoutMs = 15_000, agent?: http.Agent): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request({ host, port, method, path: route, timeout: timeoutMs, agent, headers: { 'content-type': 'application/json', ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) } }, (response) => {
      let data = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { data += chunk; });
      response.once('end', () => { let parsed: any = {}; try { parsed = data ? JSON.parse(data) : {}; } catch { reject(new Error(`Appium trả response không hợp lệ (${response.statusCode}).`)); return; } if ((response.statusCode ?? 500) >= 400 || parsed.value?.error) { reject(new Error(parsed.value?.message ?? `Appium HTTP ${response.statusCode}`)); return; } resolve(parsed); });
    });
    request.once('timeout', () => request.destroy(new Error(`Appium timeout sau ${timeoutMs}ms.`)));
    request.once('error', reject); if (payload) request.write(payload); request.end();
  });
}
