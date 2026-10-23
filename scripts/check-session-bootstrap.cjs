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

  let screen = 'auth'; const calls = [];
  const authClient = {
    find: async (_id, selector) => {
      calls.push({ type: 'find', selector });
      if (selector.text === 'Khách sạn') { if (screen === 'home') return {}; throw new Error('Home hidden'); }
      if (selector.xpath === '//XCUIElementTypeTextField[1]') { if (screen === 'login') return {}; throw new Error('Login hidden'); }
      if (selector.xpath === "//XCUIElementTypeButton[@name='Đăng nhập ngay']" && screen === 'auth') return {};
      return {};
    },
    click: async (_id, selector) => { calls.push({ type: 'click', selector }); if (selector.xpath === "//XCUIElementTypeButton[@name='Đăng nhập ngay']") screen = screen === 'auth' ? 'login' : 'home'; },
    clear: async (_id, selector) => { calls.push({ type: 'clear', selector }); },
    input: async (_id, selector, value) => { calls.push({ type: 'input', selector, value }); },
  };
  await new AppiumAutomationEngine(authClient).execute(session, ensureHome, { username: 'operator@example.test', password: 'keychain-only' });
  assert.equal(screen, 'home');
  assert.equal(calls.filter((call) => call.type === 'input').length, 2);
  assert.ok(calls.some((call) => call.type === 'click' && call.selector.xpath?.includes('Tôi đã đọc và đồng ý')));
  assert.ok(calls.some((call) => call.type === 'input' && call.value === 'operator@example.test'));
  let scrolls = 0; const taps = [];
  const listClient = {
    find: async (_id, selector) => { if (selector.xpath === '//XCUIElementTypeTable') return { value: { ELEMENT: 'table' } }; if (scrolls === 0) throw new Error('Row not rendered'); return { value: { ELEMENT: `row-${scrolls}` } }; },
    attribute: async (_id, element) => (element.value.ELEMENT === 'row-2' ? 'true' : 'false'),
    scroll: async (_id, direction, container, distance) => { assert.equal(direction, 'down'); assert.equal(container.value.ELEMENT, 'table'); assert.equal(distance, 0.3); scrolls += 1; },
    tap: async (_id, element) => { taps.push(element.value.ELEMENT); },
  };
  await new AppiumAutomationEngine(listClient).execute(session, { type: 'tapText', text: 'Chọn phòng', xpath: "//Cell[@name='{{roomType}}']", scrollContainer: '//XCUIElementTypeTable', timeoutMs: 5000 }, { roomType: 'Deluxe Twin' });
  assert.equal(scrolls, 2);
  assert.deepEqual(taps, ['row-2']);
  // A tap dropped mid-transition is retried until the expected result appears.
  let roomListTaps = 0;
  const transitionClient = {
    find: async (_id, selector) => { if (selector.text === 'Danh sách phòng' && roomListTaps < 2) throw new Error('Still on hotel page'); return { value: { ELEMENT: selector.text } }; },
    tap: async () => { roomListTaps += 1; },
  };
  await new AppiumAutomationEngine(transitionClient).execute(session, { type: 'tapText', text: 'Xem phòng', until: 'Danh sách phòng', timeoutMs: 5000 }, {});
  assert.equal(roomListTaps, 2);
  console.log('session bootstrap check ok: home reuse, auth login branches, scroll-until-visible taps and tap retry');
}

main().catch((error) => { console.error(error); process.exit(1); });
