const assert = require('node:assert/strict');
const { VinClubActionAdapter } = require('../dist-electron/src/main/vinclub-action-adapter.js');
const { AppiumAutomationEngine } = require('../dist-electron/src/main/appium-engine.js');

const session = { id: 'session', bundleId: 'net.cloudhms.booking.vinpearl', capabilities: {} };
const element = (id) => ({ value: { ELEMENT: id } });

// Calendar model (Monday first): 50px month headers, week rows every 44px, 40px cells; the calendar opens at October 2026.
const FRAME = { x: 0, y: 164, width: 375, height: 556 };
const firstWeekday = (year, month) => (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
const monthHeight = (year, month) => 50 + 44 * (Math.ceil((firstWeekday(year, month) + new Date(Date.UTC(year, month, 0)).getUTCDate()) / 7) - 1) + 40;
function headerTop(year, month, scroll) { let y = FRAME.y - scroll; for (let m = 2026 * 12 + 9; m < year * 12 + month - 1; m += 1) y += monthHeight(Math.floor(m / 12), m % 12 + 1); return y; }
const onScreen = (y, height) => y + height > FRAME.y && y < FRAME.y + FRAME.height;

function mockClient(state) {
  const calls = [];
  const client = {
    calls,
    // The calendar opens on the current month (October 2026 in this model).
    // A tap during the previous transition is dropped (`droppedOpens`), leaving the calendar closed.
    click: async (_sessionId, selector) => { calls.push({ type: 'click', selector }); if (selector.text === 'Nhận phòng') { if (state.droppedOpens) state.droppedOpens -= 1; else { state.calendarOpen = true; state.scroll = 0; } } },
    find: async (_sessionId, selector) => {
      calls.push({ type: 'find', selector });
      const header = /^Tháng (\d+) - (\d+)$/.exec(selector.text ?? '');
      if (selector.text === 'Chọn ngày') { if (state.calendarOpen) return element('calendar-title'); throw new Error('Calendar closed'); }
      if (header) { if (onScreen(headerTop(Number(header[2]), Number(header[1]), state.scroll), 50)) return element(selector.text); throw new Error('Header not laid out'); }
      if (selector.text) { if (state.exactLabels.includes(selector.text)) return element(selector.text); throw new Error('No exact label'); }
      if (selector.classChain?.includes('Button[6]')) return element('adults-minus');
      return element('other');
    },
    findAllWithFrames: async (_sessionId, selector) => {
      calls.push({ type: 'findAll', selector });
      const { predicate, xpath } = selector;
      if (xpath) {
        // Day cells exist only while their row is laid out on screen.
        const [, day] = /@name='(\d+)'/.exec(xpath); const [, month, year] = /Tháng (\d+) - (\d+)/.exec(xpath).map(Number);
        const y = headerTop(year, month, state.scroll) + 50 + 44 * Math.floor((firstWeekday(year, month) + Number(day) - 1) / 7);
        return onScreen(y, 40) ? [{ element: element(`day-${day}`), label: '', rect: { x: 261, y, width: 49, height: 40 } }] : [];
      }
      if (predicate.includes('CollectionView')) return [{ element: element('weekdays'), label: '', rect: { x: 0, y: 124, width: 375, height: 40 } }, { element: element('calendar'), label: '', rect: FRAME }];
      if (predicate.includes("BEGINSWITH 'Tháng '")) return [[2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2]].map(([year, month]) => ({ label: `Tháng ${month} - ${year}`, y: headerTop(year, month, state.scroll) })).filter(({ y }) => onScreen(y, 50)).map(({ label, y }) => ({ element: element(label), label, rect: { x: 16, y, width: 343, height: 50 } }));
      if (predicate.includes('ENDSWITH')) return [`${state.rooms} Phòng`, `${state.adults} Người lớn`, '0 Trẻ em', '0 Em bé'].map((label) => ({ element: element(label), label, rect: { x: 0, y: 0, width: 10, height: 10 } }));
      throw new Error(`Unexpected predicate ${predicate}`);
    },
    rect: async (_sessionId, target) => { const [, month, year] = /Tháng (\d+) - (\d+)/.exec(target.value.ELEMENT).map(Number); calls.push({ type: 'rect' }); return { x: 16, y: headerTop(year, month, state.scroll), width: 343, height: 50 }; },
    tap: async (_sessionId, target) => { const id = target.value.ELEMENT; calls.push({ type: 'tap', id }); if (id.startsWith('Xác nhận ') && id.endsWith(' đêm')) state.calendarOpen = false; if (id === 'adults-minus') { state.adults -= 1; state.exactLabels.push(`Xác nhận (1 phòng, ${state.adults} khách)`); } },
    // Measured on device: at ~1px/ms the calendar moves fingerPx - 30.
    drags: async (_sessionId, rect, direction, fingers) => { calls.push({ type: 'drags', rect, direction, fingers }); const moved = fingers.reduce((sum, finger) => sum + finger - 30, 0); state.scroll += direction === 'down' ? moved : -moved; return moved; },
  };
  return client;
}

async function main() {
  const state = { rooms: 1, adults: 2, scroll: 0, exactLabels: ['Xác nhận 1 đêm', 'Xác nhận 9 đêm'] };
  const client = mockClient(state);
  let today = new Date(2026, 9, 23);
  const adapter = new VinClubActionAdapter(client, undefined, () => today);
  const engine = new AppiumAutomationEngine(client, adapter);
  assert.ok(engine.capabilities.includes('selectGuests'));
  assert.ok(engine.capabilities.includes('selectDate'));

  // Guests: counts come from the form summary; only the needed taps happen and the exact confirm label verifies the totals.
  await adapter.execute(session, { type: 'selectGuests', rooms: '{{rooms}}', adults: '{{adults}}', children: '{{children}}', infants: '{{infants}}' }, { rooms: 1, adults: 1, children: 0, infants: 0 });
  assert.equal(state.adults, 1);
  assert.deepEqual(client.calls.filter((call) => call.type === 'tap').map((call) => call.id), ['adults-minus', 'Xác nhận (1 phòng, 1 khách)']);
  assert.ok(!client.calls.some((call) => call.type === 'click' && call.selector.predicate), 'The predicate confirm is only a fallback.');

  client.calls.length = 0;
  await adapter.execute(session, { type: 'selectGuests', rooms: 1, adults: 1, children: 0, infants: 0 }, {});
  assert.ok(!client.calls.some((call) => call.type === 'click' || call.type === 'tap'), 'Matching counts skip the sheet entirely.');

  // Dates: the current month's header (where the calendar opens) plans the shortest scroll that brings the day's row into view, sent as one drag.
  client.calls.length = 0;
  await adapter.execute(session, { type: 'selectDate', checkIn: '{{checkIn}}', checkOut: '{{checkOut}}' }, { checkIn: '2027-01-16', checkOut: '2027-01-17' });
  assert.ok(!client.calls.some((call) => call.type === 'findAll' && call.selector.predicate?.includes("BEGINSWITH 'Tháng '")), 'The opening month header replaces reading every header.');
  const drags = client.calls.filter((call) => call.type === 'drags');
  assert.equal(drags.length, 1, 'One drag reaches January from October.');
  assert.equal(drags[0].direction, 'down');
  assert.equal(drags[0].rect.height, 556, 'The calendar is the tall collection view, not the weekday row.');
  // Oct header y=164, +Oct 266 +Nov 310 (6 weeks) +Dec 266 = Jan at 1006; the 16th is in week 3: cell 1144-1184, brought to 16px above the bottom (704).
  assert.deepEqual(drags[0].fingers, [510]);
  assert.deepEqual(client.calls.filter((call) => call.type === 'tap').map((call) => call.id), ['day-16', 'Xác nhận 1 đêm'], 'One night: the app fills check-out after the check-in tap.');
  assert.equal(client.calls.at(-1).id, 'Xác nhận 1 đêm', 'The exact confirm label is the last call: the form is not re-read.');

  // The calendar frame is cached per session; longer stays also tap check-out, nudging the calendar when its row is below the fold.
  client.calls.length = 0;
  await adapter.execute(session, { type: 'selectDate', checkIn: '{{checkIn}}', checkOut: '{{checkOut}}' }, { checkIn: '2027-01-16', checkOut: '2027-01-25' });
  assert.ok(!client.calls.some((call) => call.type === 'findAll' && call.selector.predicate?.includes('CollectionView')));
  assert.deepEqual(client.calls.filter((call) => call.type === 'tap').map((call) => call.id), ['day-16', 'day-25', 'Xác nhận 9 đêm']);
  assert.equal(client.calls.filter((call) => call.type === 'drags').length, 2);

  // A calendar that opens elsewhere than the current month is planned from all visible headers.
  client.calls.length = 0; today = new Date(2026, 11, 1);
  await adapter.execute(session, { type: 'selectDate', checkIn: '{{checkIn}}', checkOut: '{{checkOut}}' }, { checkIn: '2027-01-16', checkOut: '2027-01-17' });
  today = new Date(2026, 9, 23);
  assert.ok(client.calls.some((call) => call.type === 'findAll' && call.selector.predicate?.includes("BEGINSWITH 'Tháng '")));
  assert.deepEqual(client.calls.filter((call) => call.type === 'drags').map((call) => call.fingers), [[510]]);

  // A cell that is laid out but cut off by the bottom bar is never tapped: the calendar is nudged first.
  client.calls.length = 0; state.scroll = 0;
  // The first drag falls 30px short (the day's row stays cut off at the bottom).
  const plan = adapter.dragCalendar.bind(adapter); let planned = 0;
  adapter.dragCalendar = async (sessionId, frame, offset) => plan(sessionId, frame, offset && !planned++ ? offset - 30 : offset);
  await adapter.execute(session, { type: 'selectDate', checkIn: '{{checkIn}}', checkOut: '{{checkOut}}' }, { checkIn: '2027-01-16', checkOut: '2027-01-17' });
  adapter.dragCalendar = plan;
  assert.equal(client.calls.filter((call) => call.type === 'drags').length, 2, 'An undershoot is corrected from the cell frame.');
  assert.deepEqual(client.calls.filter((call) => call.type === 'tap').map((call) => call.id), ['day-16', 'Xác nhận 1 đêm']);

  // A dropped "Nhận phòng" tap (calendar never opens) is retried once the sheet title fails to show.
  client.calls.length = 0; state.droppedOpens = 1;
  await adapter.execute(session, { type: 'selectDate', checkIn: '{{checkIn}}', checkOut: '{{checkOut}}' }, { checkIn: '2027-01-16', checkOut: '2027-01-17' });
  assert.equal(client.calls.filter((call) => call.type === 'click' && call.selector.text === 'Nhận phòng').length, 2);
  assert.deepEqual(client.calls.filter((call) => call.type === 'tap').map((call) => call.id), ['day-16', 'Xác nhận 1 đêm']);
  state.droppedOpens = 3;
  await assert.rejects(adapter.execute(session, { type: 'selectDate', checkIn: '2027-01-16', checkOut: '2027-01-17' }, {}), /lịch chọn ngày không mở/);
  console.log('vinclub adapter check ok: form-read guest counts, sheet skip, exact confirms, calendar open verified and retried, calendar planned from the opening month header, shortest scroll in one drag, cut-off cells nudged, check-in-only for one night');
}

main().catch((error) => { console.error(error); process.exit(1); });
