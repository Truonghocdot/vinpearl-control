import http from 'node:http';

export type AppiumElementSelector = { accessibilityId?: string; text?: string; predicate?: string; classChain?: string; xpath?: string };
// Finger travel iOS consumes before a pan starts scrolling (measured 25-30px at 1px/ms on iPhone 12 mini).
export const DRAG_SLOP = 30;
// Drags travel at ~1px/ms, then crawl the last 8px over DRAG_TAIL_MS so the finger lifts without momentum.
// Measured on device: at that speed the list moves fingerPx - DRAG_SLOP; faster drags lose more (534px moved only 457px at 3.5px/ms).
const DRAG_TAIL_MS = 200;
// Each drag costs ~1s on device whatever its length, so fingers start and end close to the container's edges.
const DRAG_MARGIN = 0.02;
// WDA ports are 8100-8199 (one per device), so MJPEG ports land on 9100-9199.
const MJPEG_PORT_OFFSET = 1000;
export type ElementRect = { x: number; y: number; width: number; height: number };
// Minimal scroll that brings [top, top + height] inside the frame, landing `pad` from the edge it enters from; positive scrolls down, 0 when already inside.
export function offsetIntoView(top: number, height: number, frame: ElementRect, pad = 16) {
  if (top >= frame.y && top + height <= frame.y + frame.height) return 0;
  return top + height > frame.y + frame.height ? top + height - (frame.y + frame.height - pad) : top - (frame.y + pad);
}
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
  reduceMotion?: boolean;
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
  private readonly reduceMotion: boolean;
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
    this.reduceMotion = options.reduceMotion ?? true;
    this.maxTypingFrequency = options.maxTypingFrequency ?? 60;
    this.webDriverAgentUrl = options.webDriverAgentUrl;
    this.agent = options.agent ?? new http.Agent({ keepAlive: true, maxSockets: 8 });
    this.request = options.request ?? requestJson;
  }

  async health() {
    const response = await this.request(this.host, this.port, 'GET', '/status', undefined, this.timeoutMs, this.agent);
    return Boolean((response.value as { ready?: boolean } | undefined)?.ready ?? response.ready);
  }

  // A webDriverAgentUrl attaches to a WDA already running on the iPhone (IP devices): nothing is launched or forwarded over USB.
  // The driver still checks the app (bundleId), resets it (noReset=false), reads syslog and asks lockdown for the iOS version over the
  // device link, so IP sessions skip all four (platformVersion comes from WDA's /status) and only speak HTTP to WDA; the app is
  // launched and restarted through WDA instead.
  async createSession(udid: string, bundleId: string, wdaLocalPort: number, options: { noReset?: boolean; webDriverAgentUrl?: string; platformVersion?: string } = {}): Promise<AppiumSession> {
    const alwaysMatch: Record<string, unknown> = {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': udid,
      // Sessions are kept warm between runs; Appium reclaims them after 30 idle minutes.
      'appium:newCommandTimeout': 1800,
      'appium:useNewWDA': false,
      'appium:wdaStartupRetries': 1,
      'appium:wdaStartupRetryInterval': 1_000,
      'appium:waitForIdleTimeout': this.waitForIdleTimeout,
      'appium:settings[animationCoolOffTimeout]': this.animationCoolOffTimeout,
      // Shorter iOS transitions: fewer taps land mid-animation. This toggles the device's Reduce Motion setting.
      'appium:reduceMotion': this.reduceMotion,
      'appium:maxTypingFrequency': this.maxTypingFrequency,
      'appium:shouldUseCompactResponses': true,
      'appium:elementResponseAttributes': 'type,label',
      'appium:showXcodeLog': true,
      // Keep the app on the safe-stop screen for operator review; the next session relaunches it anyway.
      'appium:shouldTerminateApp': false,
    };
    if (options.webDriverAgentUrl) Object.assign(alwaysMatch, { 'appium:noReset': true, 'appium:skipLogCapture': true }, options.platformVersion ? { 'appium:platformVersion': options.platformVersion } : {});
    else { alwaysMatch['appium:bundleId'] = bundleId; if (options.noReset) alwaysMatch['appium:noReset'] = true; }
    if (this.xcodeOrgId) {
      alwaysMatch['appium:xcodeOrgId'] = this.xcodeOrgId;
      alwaysMatch['appium:xcodeSigningId'] = this.xcodeSigningId;
    }
    const webDriverAgentUrl = options.webDriverAgentUrl ?? this.webDriverAgentUrl;
    if (webDriverAgentUrl) alwaysMatch['appium:webDriverAgentUrl'] = webDriverAgentUrl;
    if (!options.webDriverAgentUrl) {
      alwaysMatch['appium:wdaLocalPort'] = wdaLocalPort;
      // Each device's MJPEG screen stream is forwarded to its own Mac port (the 9100 default collides between parallel devices).
      alwaysMatch['appium:mjpegServerPort'] = wdaLocalPort + MJPEG_PORT_OFFSET;
    }
    const response = await this.request(this.host, this.port, 'POST', '/session', {
      capabilities: { alwaysMatch },
    }, this.sessionStartupTimeoutMs, this.agent);
    const sessionId = String(response.sessionId ?? response.value?.sessionId ?? '');
    if (!sessionId) throw new Error('Appium không trả về session id.');
    return { id: sessionId, bundleId, capabilities: response.value ?? {} };
  }

  // Appium cannot start WDA over the network, so an IP device's WDA must answer before a session is attempted (null when it does not).
  async wdaStatus(host: string, port: number): Promise<{ platformVersion?: string } | null> { try { const response = await this.request(host, port, 'GET', '/status', undefined, 3_000); const version = response.value?.os?.version; return { platformVersion: typeof version === 'string' ? version : undefined }; } catch { return null; } }
  async deleteSession(sessionId: string) { await this.request(this.host, this.port, 'DELETE', `/session/${encodeURIComponent(sessionId)}`, undefined, this.timeoutMs, this.agent); }
  async launch(session: AppiumSession) { return this.post(session.id, '/appium/device/activate_app', { bundleId: session.bundleId }); }
  // A kept-alive session starts each run from a fresh app process, like a new session would.
  async restartApp(session: AppiumSession) {
    await this.post(session.id, '/execute/sync', { script: 'mobile: terminateApp', args: [{ bundleId: session.bundleId }] });
    return this.post(session.id, '/execute/sync', { script: 'mobile: activateApp', args: [{ bundleId: session.bundleId }] });
  }
  async isAlive(sessionId: string) { try { await this.get(sessionId, ''); return true; } catch { return false; } }
  async screenshot(sessionId: string) { return String((await this.get(sessionId, '/screenshot')).value ?? ''); }
  async find(sessionId: string, selector: AppiumElementSelector) {
    if (selector.accessibilityId) return this.post(sessionId, '/element', { using: 'accessibility id', value: selector.accessibilityId });
    if (selector.predicate) return this.post(sessionId, '/element', { using: '-ios predicate string', value: selector.predicate });
    if (selector.classChain) return this.post(sessionId, '/element', { using: '-ios class chain', value: selector.classChain });
    if (selector.xpath) return this.post(sessionId, '/element', { using: 'xpath', value: selector.xpath });
    if (!selector.text) throw new Error('Selector accessibilityId, text, predicate, classChain hoặc xpath là bắt buộc.');
    // Visible texts in MyVinpearl are exposed as the element name; accessibility id lookups are ~40% faster than predicates.
    return this.post(sessionId, '/element', { using: 'accessibility id', value: selector.text });
  }
  // Label and frame come back with the element list, instead of two extra round trips per element.
  // (WDA's `name` response attribute is the element type, so the accessible text is read from `label`.)
  async findAllWithFrames(sessionId: string, selector: { predicate: string } | { xpath: string }) {
    await this.post(sessionId, '/appium/settings', { settings: { shouldUseCompactResponses: false, elementResponseAttributes: 'label,rect' } });
    try {
      const query = 'xpath' in selector ? { using: 'xpath', value: selector.xpath } : { using: '-ios predicate string', value: selector.predicate };
      const elements = ((await this.post(sessionId, '/elements', query)).value ?? []) as Array<Record<string, unknown>>;
      return Promise.all(elements.map(async (raw) => {
        const element = { value: raw };
        // Elements without a label (e.g. collection views) report null, which is not a reason for an extra round trip.
        return { element, label: 'label' in raw ? String(raw.label ?? '') : await this.attribute(sessionId, element, 'label'), rect: (raw.rect as ElementRect | undefined) ?? await this.rect(sessionId, element) };
      }));
    } finally { await this.post(sessionId, '/appium/settings', { settings: { shouldUseCompactResponses: true } }); }
  }
  async findAll(sessionId: string, selector: { predicate: string }) { return (((await this.post(sessionId, '/elements', { using: '-ios predicate string', value: selector.predicate })).value ?? []) as unknown[]).map((element) => ({ value: element })); }
  async click(sessionId: string, selector: AppiumElementSelector) { return this.tap(sessionId, await this.find(sessionId, selector)); }
  async tap(sessionId: string, element: unknown) { return this.post(sessionId, `/element/${elementId(element)}/click`, {}); }
  async input(sessionId: string, selector: AppiumElementSelector, value: string) { return this.typeInto(sessionId, await this.find(sessionId, selector), value); }
  async clear(sessionId: string, selector: AppiumElementSelector) { return this.clearElement(sessionId, await this.find(sessionId, selector)); }
  async typeInto(sessionId: string, element: unknown, value: string) { return this.post(sessionId, `/element/${elementId(element)}/value`, { text: value, value: Array.from(value) }); }
  async clearElement(sessionId: string, element: unknown) { return this.post(sessionId, `/element/${elementId(element)}/clear`, {}); }
  async text(sessionId: string, selector: AppiumElementSelector) { const element = await this.find(sessionId, selector); return String((await this.get(sessionId, `/element/${elementId(element)}/text`)).value ?? ''); }
  // A W3C drag inside the container's frame (or the window), travelling `distance` of its height.
  async scroll(sessionId: string, direction: 'up' | 'down', container?: unknown, distance = 0.6) {
    const rect = container ? await this.rect(sessionId, container) : (await this.get(sessionId, '/window/rect')).value as ElementRect;
    return this.dragBy(sessionId, rect, direction, rect.height * distance);
  }
  // Drags the finger `fingerPx` inside `rect`. The last few pixels are travelled slowly so the finger lifts at ~0 velocity:
  // measured on device, the list then stops at once and moves by fingerPx - DRAG_SLOP (no momentum to wait out).
  async dragBy(sessionId: string, rect: ElementRect, direction: 'up' | 'down', fingerPx: number) { return this.drags(sessionId, rect, direction, [fingerPx]); }
  // Several drags in one W3C call (each call costs ~1s of fixed overhead on device). Each drag uses its own pointer that
  // waits for the previous one: repeated down/up on a single pointer is merged into one path that drags the list back.
  async drags(sessionId: string, rect: ElementRect, direction: 'up' | 'down', fingerPxs: number[]) {
    const margin = rect.height * DRAG_MARGIN; const x = Math.round(rect.x + rect.width / 2); const bottom = Math.round(rect.y + rect.height - margin); const top = Math.round(rect.y + margin);
    let moved = 0;
    let startAt = 0;
    const pointers = fingerPxs.map((fingerPx, index) => {
      const travel = Math.round(Math.min(Math.max(fingerPx, DRAG_SLOP + 10), rect.height - 2 * margin));
      const [from, to] = direction === 'down' ? [bottom, bottom - travel] : [top, top + travel]; const tail = direction === 'down' ? 8 : -8;
      const sweep = Math.max(150, travel); const pause = startAt; startAt += sweep + DRAG_TAIL_MS + 50;
      moved += travel - DRAG_SLOP;
      return { type: 'pointer', id: `finger${index}`, parameters: { pointerType: 'touch' }, actions: [
        ...(pause ? [{ type: 'pause', duration: pause }] : []),
        { type: 'pointerMove', duration: 0, x, y: from }, { type: 'pointerDown', button: 0 }, { type: 'pointerMove', duration: sweep, x, y: to + tail }, { type: 'pointerMove', duration: DRAG_TAIL_MS, x, y: to }, { type: 'pointerUp', button: 0 },
      ] };
    });
    await this.post(sessionId, '/actions', { actions: pointers });
    return moved;
  }
  // Largest finger travel a single drag can make inside `rect`.
  static maxDrag(rect: ElementRect) { return rect.height * (1 - 2 * DRAG_MARGIN); }
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
