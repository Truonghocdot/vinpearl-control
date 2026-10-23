const assert = require('node:assert/strict');
const { AppiumAutomationEngine } = require('../dist-electron/src/main/appium-engine.js');

const session = { id: 'session', bundleId: 'net.cloudhms.booking.vinpearl', capabilities: {} };
const ensureHome = { type: 'ensureHome', timeoutMs: 30000 };

async function main() {
  const homeCalls = [];
  const homeClient = {
    find: async (_id, selector) => { homeCalls.push(selector); if (selector.text === 'Khách sạn') return {}; throw new Error('Unexpected selector'); },
  };
  await new AppiumAutomationEngine(homeClient).execute(session, ensureHome, {});
  assert.equal(homeCalls.length, 1);

  // Login is not automated: a logged-out device fails with a clear message instead of typing credentials.
  const loginClient = { find: async (_id, selector) => { if (selector.xpath === "//XCUIElementTypeButton[@name='Đăng nhập ngay']") return {}; throw new Error('Not on home'); } };
  await assert.rejects(new AppiumAutomationEngine(loginClient).execute(session, { type: 'ensureHome', timeoutMs: 300 }, {}), /chưa đăng nhập/);
  let scrolls = 0; const taps = [];
  const listClient = {
    find: async (_id, selector) => { if (selector.xpath === '//XCUIElementTypeTable') return { value: { ELEMENT: 'table' } }; if (scrolls === 0) throw new Error('Row not rendered'); return { value: { ELEMENT: `row-${scrolls}` } }; },
    attribute: async (_id, element) => (element.value.ELEMENT === 'row-2' ? 'true' : 'false'),
    scroll: async (_id, direction, container, distance) => { assert.equal(direction, 'down'); assert.equal(container.value.ELEMENT, 'table'); assert.equal(distance, 0.3); scrolls += 1; },
    rect: async () => ({ x: 0, y: 300, width: 375, height: 57 }),
    tap: async (_id, element) => { taps.push(element.value.ELEMENT); },
  };
  await new AppiumAutomationEngine(listClient).execute(session, { type: 'tapText', text: 'Chọn phòng', xpath: "//Cell[@name='{{roomType}}']", scrollContainer: '//XCUIElementTypeTable', timeoutMs: 5000 }, { roomType: 'Deluxe Twin' });
  assert.equal(scrolls, 2);
  assert.deepEqual(taps, ['row-2']);
  // A tap dropped mid-transition is retried until the expected result appears; only `settle` steps wait for the target to stop moving.
  let roomListTaps = 0; let rects = 0;
  const transitionClient = {
    find: async (_id, selector) => { if (selector.text === 'Danh sách phòng' && roomListTaps < 2) throw new Error('Still on hotel page'); return { value: { ELEMENT: selector.text } }; },
    rect: async () => { rects += 1; return { x: 0, y: 700, width: 120, height: 43 }; },
    tap: async () => { roomListTaps += 1; },
  };
  const transitionEngine = new AppiumAutomationEngine(transitionClient);
  await transitionEngine.execute(session, { type: 'tapText', text: 'Xem phòng', settle: true, until: 'Danh sách phòng', timeoutMs: 5000 }, {});
  assert.equal(roomListTaps, 2);
  assert.ok(rects >= 2, 'settle reads the frame until it is still');
  rects = 0;
  await transitionEngine.execute(session, { type: 'tapText', text: 'Xong', until: 'Danh sách phòng' }, {});
  assert.equal(rects, 0, 'Taps without settle go straight out.');
  // The `until` element is handed to the next step instead of being looked up again, and only to that step.
  const handoffFinds = [];
  const handoffClient = { find: async (_id, selector) => { handoffFinds.push(selector.xpath ?? selector.text); return { value: { ELEMENT: selector.xpath ?? selector.text } }; }, tap: async () => undefined, clearElement: async () => undefined, typeInto: async (_id, element) => { handoffFinds.push(`typed:${element.value.ELEMENT}`); } };
  const handoffEngine = new AppiumAutomationEngine(handoffClient);
  await handoffEngine.execute(session, { type: 'tapText', text: 'Tìm', until: '//TextField' }, {});
  await handoffEngine.execute(session, { type: 'inputText', target: 'Tìm địa điểm', xpath: '//TextField', value: 'ha tinh' }, {});
  await handoffEngine.execute(session, { type: 'tapText', text: 'Khách sạn', until: '//Button' }, {});
  await handoffEngine.execute(session, { type: 'waitForText', text: 'Khác' }, {});
  await handoffEngine.execute(session, { type: 'tapText', text: 'Tìm kiếm', xpath: '//Button' }, {});
  assert.deepEqual(handoffFinds, ['Tìm', '//TextField', 'typed://TextField', 'Khách sạn', '//Button', 'Khác', '//Button']);
  // An element from the outgoing screen goes stale mid-push; it is looked up again instead of failing the step.
  let lookups = 0; let staleTaps = 0;
  const staleClient = { find: async () => ({ value: { ELEMENT: `e${++lookups}` } }), tap: async (_id, element) => { if (element.value.ELEMENT === 'e1') throw new Error('The previously found element is not present in the current view anymore.'); staleTaps += 1; } };
  await new AppiumAutomationEngine(staleClient).execute(session, { type: 'tapText', text: 'Phòng 1: Deluxe Twin', until: 'Nhập thông tin khách' }, {});
  assert.equal(staleTaps, 1);
  // A remembered toggle is left alone instead of being switched off.
  let termTaps = 0;
  const toggleClient = { find: async (_id, selector) => ({ value: { ELEMENT: selector.xpath ?? selector.text } }), rect: async () => ({ x: 16, y: 620, width: 24, height: 24 }), tap: async () => { termTaps += 1; } };
  await new AppiumAutomationEngine(toggleClient).execute(session, { type: 'tapText', text: 'Điều khoản', xpath: '//Image', until: "//Button[@enabled='true']", skipIfUntil: true }, {});
  assert.equal(termTaps, 0);
  // Warm sessions: create once, then only restart the app; a dead session is replaced.
  const device = { udid: '00008101-001D48683E88001E', bundleId: 'net.cloudhms.booking.vinpearl', wdaLocalPort: 8100 };
  const pool = []; let created = 0; let alive = true;
  const poolClient = {
    createSession: async (_udid, bundleId, _port, options) => { created += 1; pool.push({ type: 'create', noReset: options.noReset }); return { id: `s${created}`, bundleId, capabilities: {} }; },
    isAlive: async () => alive,
    restartApp: async (cached) => { pool.push({ type: 'restart', id: cached.id }); },
    deleteSession: async (id) => { pool.push({ type: 'delete', id }); },
  };
  const poolEngine = new AppiumAutomationEngine(poolClient);
  assert.equal((await poolEngine.acquireSession(device, { restartApp: false })).id, 's1');
  assert.equal((await poolEngine.acquireSession(device)).id, 's1');
  alive = false;
  assert.equal((await poolEngine.acquireSession(device)).id, 's2');
  alive = true;
  await poolEngine.discardSession({ id: 's2' });
  assert.equal((await poolEngine.acquireSession(device)).id, 's3');
  assert.deepEqual(pool.map((entry) => entry.type), ['create', 'restart', 'delete', 'create', 'delete', 'create']);
  assert.equal(pool[0].noReset, true, 'Health checks keep the current screen.');
  assert.equal(pool[3].noReset, false, 'A fresh run session relaunches the app.');
  // Several devices: session creation is serialised (WDA launches share DerivedData), and a failed launch does not block the next device.
  let creating = 0; let overlap = false; const order = [];
  const parallelClient = {
    createSession: async (udid, bundleId) => { creating += 1; overlap ||= creating > 1; order.push(udid); await new Promise((resolve) => setTimeout(resolve, 20)); creating -= 1; if (udid === 'bad') throw new Error('WDA failed'); return { id: `s-${udid}`, bundleId, capabilities: {} }; },
    isAlive: async () => true, restartApp: async () => undefined, deleteSession: async () => undefined,
  };
  const parallelEngine = new AppiumAutomationEngine(parallelClient);
  const results = await Promise.allSettled(['A', 'bad', 'B'].map((udid, index) => parallelEngine.acquireSession({ udid, bundleId: 'net.cloudhms.booking.vinpearl', wdaLocalPort: 8100 + index })));
  assert.equal(overlap, false, 'Only one WDA session starts at a time.');
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal((await parallelEngine.acquireSession({ udid: 'A', bundleId: 'net.cloudhms.booking.vinpearl', wdaLocalPort: 8100 })).id, 's-A', 'Warm sessions are kept per device.');
  // IP devices: the session attaches to the WDA URL, and an unreachable WDA fails before Appium is asked.
  const ipCalls = []; let reachable = false;
  const ipClient = { ...parallelClient, restartApp: async (session) => { ipCalls.push(`restart ${session.id}`); }, wdaStatus: async (host, port) => { ipCalls.push(`${host}:${port}`); return reachable ? { platformVersion: '15.8.8' } : null; }, createSession: async (udid, bundleId, _port, options) => { ipCalls.push(options.webDriverAgentUrl); if (options.webDriverAgentUrl) assert.equal(options.platformVersion, '15.8.8'); return { id: `s-${udid}`, bundleId, capabilities: {} }; } };
  const ipDevice = { udid: 'W', bundleId: 'net.cloudhms.booking.vinpearl', wdaLocalPort: 8100, connectionType: 'ip', ipAddress: '192.168.1.20' };
  await assert.rejects(new AppiumAutomationEngine(ipClient).acquireSession(ipDevice), /WDA tại http:\/\/192\.168\.1\.20:8100/);
  reachable = true;
  await new AppiumAutomationEngine(ipClient).acquireSession(ipDevice);
  await new AppiumAutomationEngine(ipClient).acquireSession(ipDevice, { restartApp: false });
  await new AppiumAutomationEngine(ipClient).acquireSession({ ...ipDevice, connectionType: 'usb' });
  assert.deepEqual(ipCalls, ['192.168.1.20:8100', '192.168.1.20:8100', 'http://192.168.1.20:8100', 'restart s-W', '192.168.1.20:8100', 'http://192.168.1.20:8100', undefined], 'A new IP run session restarts the app through WDA; USB devices ignore a stale IP.');
  console.log('session bootstrap check ok: serialised multi-device session start, IP attach, warm session reuse, home reuse, logged-out device error, scroll-until-visible taps, tap retry, opt-in settle, until handoff, stale element lookups and remembered toggles');
}

main().catch((error) => { console.error(error); process.exit(1); });
