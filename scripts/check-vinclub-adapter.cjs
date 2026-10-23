const assert = require('node:assert/strict');
const { VinClubActionAdapter } = require('../dist-electron/src/main/vinclub-action-adapter.js');
const { AppiumAutomationEngine } = require('../dist-electron/src/main/appium-engine.js');

const calls = [];
const values = new Map([['adults', 2], ['children', 0], ['infants', 0]]);
const client = {
  click: async (_sessionId, selector) => {
    calls.push({ type: 'click', selector });
    const chain = selector.classChain ?? '';
    if (chain.includes('Button[6]')) values.set('adults', values.get('adults') - 1);
    if (chain.includes('Button[1]') && chain.includes('Cell[1]')) values.set('adults', values.get('adults') + 1);
  },
  text: async (_sessionId, selector) => {
    if (selector.xpath?.includes("Số lượng phòng")) return '1';
    if (selector.xpath?.includes("@name='Người lớn'")) return String(values.get('adults'));
    if (selector.xpath?.includes("@name='Trẻ em'")) return String(values.get('children'));
    if (selector.xpath?.includes("@name='Em bé'")) return String(values.get('infants'));
    throw new Error(`No mock value for ${JSON.stringify(selector)}`);
  },
  find: async (_sessionId, selector) => {
    calls.push({ type: 'find', selector });
    if (selector.xpath?.includes('XCUIElementTypeCollectionView[')) return { value: { ELEMENT: 'calendar' } };
    // Day cells are only matchable while their month header is laid out.
    if (selector.xpath?.includes('XCUIElementTypeCell[')) { if (!client.monthVisible) throw new Error('Month is outside viewport'); return { value: { ELEMENT: `day-${/@name='(\d+)'/.exec(selector.xpath)[1]}` } }; }
    return {};
  },
  findAll: async () => (client.monthVisible ? [['Tháng 1 - 2027', 180], ['Tháng 2 - 2027', 446]] : [['Tháng 10 - 2026', 200], ['Tháng 11 - 2026', 466]]).map(([name, y]) => ({ value: { ELEMENT: name }, y })),
  attribute: async (_sessionId, element, name) => (name === 'visible' ? 'true' : element.value.ELEMENT),
  rect: async (_sessionId, element) => (element.value.ELEMENT === 'calendar' ? { x: 0, y: 164, width: 375, height: 556 } : { x: 16, y: element.value.ELEMENT.endsWith('2026') ? (element.value.ELEMENT.startsWith('Tháng 10') ? 200 : 466) : 0, width: 343, height: 51 }),
  tap: async (_sessionId, element) => { calls.push({ type: 'tap', element: element.value.ELEMENT }); },
  monthVisible: false,
  scroll: async (_sessionId, direction, container, distance) => { calls.push({ type: 'scroll', direction, container: container.value.ELEMENT, distance }); client.monthVisible = true; },
};

async function main() {
  const adapter = new VinClubActionAdapter(client);
  const engine = new AppiumAutomationEngine(client, adapter);
  assert.ok(engine.capabilities.includes('selectGuests'));
  assert.ok(engine.capabilities.includes('selectDate'));
  await adapter.execute({ id: 'session', bundleId: 'net.cloudhms.booking.vinpearl', capabilities: {} }, { type: 'selectGuests', rooms: '{{rooms}}', adults: '{{adults}}', children: '{{children}}', infants: '{{infants}}' }, { rooms: 1, adults: 1, children: 0, infants: 0 });
  assert.equal(values.get('adults'), 1);
  assert.ok(calls.some((call) => call.selector?.predicate === "name BEGINSWITH 'Xác nhận ('"));

  calls.length = 0;
  await adapter.execute({ id: 'session', bundleId: 'net.cloudhms.booking.vinpearl', capabilities: {} }, { type: 'selectDate', checkIn: '{{checkIn}}', checkOut: '{{checkOut}}' }, { checkIn: '2027-01-16', checkOut: '2027-01-17' });
  const scrolls = calls.filter((call) => call.type === 'scroll');
  assert.equal(scrolls.length, 1, 'Header positions should steer one drag from October to January.');
  assert.equal(scrolls[0].direction, 'down');
  assert.equal(scrolls[0].container, 'calendar');
  // Nearest header Nov 2026 at y=466, 266px per month: (466 + 2*266 - 172) / 2 / 556 ≈ 0.74, capped at 0.7.
  assert.equal(scrolls[0].distance, 0.7);
  assert.deepEqual(calls.filter((call) => call.type === 'tap').map((call) => call.element), ['day-16', 'day-17']);
  assert.ok(calls.some((call) => call.selector?.predicate === "name BEGINSWITH 'Xác nhận'"));
  console.log('vinclub adapter check ok: guest counters, month scrolling, header-steered calendar drag, scoped day selection and confirmation');
}

main().catch((error) => { console.error(error); process.exit(1); });
