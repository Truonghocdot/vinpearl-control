import { AppiumClient, DRAG_SLOP, offsetIntoView, type AppiumElementSelector, type AppiumSession, type ElementRect } from './appium-client';
import type { WorkflowStep } from './workflow-runner';

export type VinClubSelectorProfile = {
  date: { open: AppiumElementSelector; title: AppiumElementSelector; dayInMonth: (monthLabel: string, day: number) => { xpath: string }; confirm: AppiumElementSelector };
  guests: { open: AppiumElementSelector; rooms: CounterButtons; adults: CounterButtons; children: CounterButtons; infants: CounterButtons; confirm: AppiumElementSelector };
};

type MonthHeader = { index: number; y: number };
type CounterButtons = { increment: AppiumElementSelector; decrement: AppiumElementSelector };
type GuestCounts = { rooms: number; adults: number; children: number; infants: number };

export const vinClubSelectorProfile: VinClubSelectorProfile = {
  date: {
    // The label sits on the date button and lets touches through; an accessibility id lookup is ~0.15s cheaper than the button's xpath.
    open: { text: 'Nhận phòng' },
    // Title of the calendar sheet; not on the search form.
    title: { text: 'Chọn ngày' },
    // The day is scoped to the immediately preceding month header, so identical days in adjacent months cannot collide.
    dayInMonth: (monthLabel, day) => ({ xpath: `//XCUIElementTypeCell[XCUIElementTypeStaticText[@name=${xpathString(day)}] and preceding-sibling::XCUIElementTypeOther[1][XCUIElementTypeStaticText[@name=${xpathString(monthLabel)}]]]` }),
    // Fallback when the exact "Xác nhận N đêm" label is not found.
    confirm: { predicate: "name BEGINSWITH 'Xác nhận'" },
  },
  guests: {
    open: { xpath: "//XCUIElementTypeOther[XCUIElementTypeStaticText[contains(@name, 'Phòng')]]//XCUIElementTypeButton[1]" },
    rooms: {
      increment: { xpath: "//XCUIElementTypeStaticText[@name='Số lượng phòng']/following-sibling::XCUIElementTypeOther//XCUIElementTypeButton[@name='button add active']" },
      decrement: { xpath: "//XCUIElementTypeStaticText[@name='Số lượng phòng']/following-sibling::XCUIElementTypeOther//XCUIElementTypeButton[@name='button minus enable']" },
    },
    adults: counter(1, 6),
    children: counter(3, 2),
    infants: counter(5, 4),
    // Fallback when the exact "Xác nhận (R phòng, G khách)" label is not found.
    confirm: { predicate: "name BEGINSWITH 'Xác nhận ('" },
  },
};

// The guest controls have no unique IDs. These positions are semantic child positions in the room cell, not screen coordinates.
function counter(increment: number, decrement: number): CounterButtons {
  const cell = '**/XCUIElementTypeTable/XCUIElementTypeCell[1]';
  return { increment: { classChain: `${cell}/XCUIElementTypeButton[${increment}]` }, decrement: { classChain: `${cell}/XCUIElementTypeButton[${decrement}]` } };
}

// The search form summarises the counters as "1 Phòng", "2 Người lớn", "0 Trẻ em", "0 Em bé".
const FORM_COUNTS: Array<[keyof GuestCounts, string, string]> = [['rooms', 'Phòng', 'phòng'], ['adults', 'Người lớn', 'người lớn'], ['children', 'Trẻ em', 'trẻ em'], ['infants', 'Em bé', 'em bé']];
const FORM_COUNT_LABELS = `type == 'XCUIElementTypeStaticText' AND (${FORM_COUNTS.map(([, suffix]) => `label ENDSWITH ' ${suffix}'`).join(' OR ')})`;

export class VinClubActionAdapter {
  // The calendar frame is the same for every run on a session's device; looking it up costs ~0.8s.
  private readonly calendarFrames = new Map<string, ElementRect>();
  constructor(private readonly client: AppiumClient, private readonly profile: VinClubSelectorProfile = vinClubSelectorProfile, private readonly today = () => new Date()) {}

  async execute(session: AppiumSession, step: WorkflowStep, variables: Record<string, unknown>) {
    if (step.type === 'selectDate') return this.selectDate(session, value(step.checkIn, variables), value(step.checkOut, variables));
    if (step.type === 'selectGuests') return this.selectGuests(session, {
      rooms: integer(step.rooms, variables, 'rooms'), adults: integer(step.adults, variables, 'adults'), children: integer(step.children, variables, 'children'), infants: integer(step.infants, variables, 'infants'),
    });
    throw new Error(`VinClub adapter không hỗ trợ ${step.type}.`);
  }

  private async selectGuests(session: AppiumSession, target: GuestCounts) {
    const sessionId = session.id;
    // One lookup of the form summary (~0.5s) replaces reading each counter in the sheet, and skips the sheet when nothing changes.
    const current = await this.formGuestCounts(sessionId);
    if (FORM_COUNTS.every(([key]) => current[key] === target[key])) return;
    await this.client.click(sessionId, this.profile.guests.open);
    for (const [key] of FORM_COUNTS) {
      const delta = target[key] - current[key]; const buttons = this.profile.guests[key];
      for (let index = 0; index < Math.abs(delta); index += 1) await this.tapWhenPresent(sessionId, delta > 0 ? buttons.increment : buttons.decrement);
    }
    // The confirm label carries the totals, so finding it by its exact text also verifies the counters.
    if (await this.tapExact(sessionId, `Xác nhận (${target.rooms} phòng, ${target.adults + target.children} khách)`)) return;
    await this.client.click(sessionId, this.profile.guests.confirm);
    const final = await this.formGuestCounts(sessionId);
    for (const [key, , label] of FORM_COUNTS) if (final[key] !== target[key]) throw new Error(`Không cập nhật được ${label} tới ${target[key]} (đang là ${final[key]}).`);
  }

  private async formGuestCounts(sessionId: string) {
    for (let check = 0; check < 10; check += 1) {
      const labels = (await this.client.findAllWithFrames(sessionId, { predicate: FORM_COUNT_LABELS })).map((item) => item.label);
      const counts = {} as GuestCounts; let complete = true;
      for (const [key, suffix] of FORM_COUNTS) { const match = labels.map((label) => new RegExp(`^(\\d+) ${suffix}$`).exec(label)).find(Boolean); if (match) counts[key] = Number(match[1]); else complete = false; }
      if (complete) return counts;
      await sleep(150);
    }
    throw new Error('Không đọc được số phòng/khách trên form tìm khách sạn.');
  }

  // The sheet slides up after opening, so the first counter tap waits for its button.
  private async tapWhenPresent(sessionId: string, selector: AppiumElementSelector) {
    for (let check = 0; ; check += 1) {
      try { return await this.client.tap(sessionId, await this.client.find(sessionId, selector)); } catch (error) { if (check >= 20) throw error; await sleep(150); }
    }
  }

  private async selectDate(session: AppiumSession, checkIn: string, checkOut: string) {
    const sessionId = session.id;
    const start = parseDate(checkIn, 'checkIn'); const end = parseDate(checkOut, 'checkOut');
    if (end <= start) throw new Error('checkOut phải sau checkIn.');
    const nights = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    await this.openCalendar(sessionId);
    const frame = await this.calendarFrame(sessionId);
    await this.pickDay(sessionId, start, frame, await this.openingHeaders(sessionId));
    // The app defaults the stay to one night after a check-in tap, so check-out is only tapped for longer stays.
    if (nights > 1) await this.pickDay(sessionId, end, frame);
    // The form is not re-read afterwards: drags stop without momentum, so the day cell found on the still calendar is the one tapped.
    if (!await this.tapExact(sessionId, `Xác nhận ${nights} đêm`)) await this.client.click(sessionId, this.profile.date.confirm);
  }

  // Without idle waits a tap during the previous transition is dropped (seen on iPhone 7 right after the guest step), so the
  // sheet's title confirms the calendar opened and a missing sheet gets another tap.
  private async openCalendar(sessionId: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.client.click(sessionId, this.profile.date.open);
      if (await this.appears(sessionId, this.profile.date.title, attempt ? 4_000 : 2_000)) return;
    }
    throw new Error('Đã chạm "Nhận phòng" 3 lần nhưng lịch chọn ngày không mở.');
  }

  private async appears(sessionId: string, selector: AppiumElementSelector, timeoutMs: number) {
    for (const started = Date.now(); ;) {
      try { await this.client.find(sessionId, selector); return true; } catch { if (Date.now() - started > timeoutMs) return false; await sleep(150); }
    }
  }

  // The weekday row is also a collection view; the calendar is the tall one.
  private async calendarFrame(sessionId: string) {
    const cached = this.calendarFrames.get(sessionId); if (cached) return cached;
    for (let check = 0; check < 10; check += 1) {
      const views = await this.client.findAllWithFrames(sessionId, { predicate: "type == 'XCUIElementTypeCollectionView'" });
      const calendar = views.sort((left, right) => right.rect.height - left.rect.height)[0];
      if (calendar && calendar.rect.height > 200) { this.calendarFrames.set(sessionId, calendar.rect); return calendar.rect; }
      await sleep(150);
    }
    throw new Error('Không thấy lịch chọn ngày.');
  }

  private async pickDay(sessionId: string, date: Date, frame: ElementRect, headers?: MonthHeader[]) {
    const monthLabel = formatVietnameseMonth(date); const day = this.profile.date.dayInMonth(monthLabel, date.getUTCDate());
    // Plan from the month headers on screen: scroll only until the day's row is in view (each drag costs ~1s).
    await this.dragCalendar(sessionId, frame, offsetToDay(headers ?? await this.monthHeaders(sessionId), date, frame));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // The calendar is still now, so the cell found is the one on screen (cells are recycled only while scrolling).
      // Its frame comes with the lookup; a cell under the bottom bar would turn the tap into a confirm, so it must be fully inside.
      const [cell] = await this.client.findAllWithFrames(sessionId, day);
      const offset = cell ? offsetIntoView(cell.rect.y, cell.rect.height, frame) : offsetToDay(await this.monthHeaders(sessionId), date, frame);
      if (cell && !offset) return this.client.tap(sessionId, cell.element);
      await this.dragCalendar(sessionId, frame, offset);
    }
    throw new Error(`Không tìm thấy ngày ${date.getUTCDate()} trong ${monthLabel}.`);
  }

  // The calendar opens on the current month: finding that one header by accessibility id, with its frame (~0.25s), replaces
  // reading every header (~0.6s) and also waits for the calendar to appear. Any other opening position falls back to the full read.
  private async openingHeaders(sessionId: string): Promise<MonthHeader[]> {
    const today = this.today(); const label = `Tháng ${today.getMonth() + 1} - ${today.getFullYear()}`;
    for (let check = 0; check < 8; check += 1) {
      try { const header = await this.client.find(sessionId, { text: label }); return [{ index: monthIndex(today.getFullYear(), today.getMonth() + 1), y: (await this.client.rect(sessionId, header)).y }]; }
      catch { await sleep(100); }
    }
    return this.monthHeaders(sessionId);
  }

  // Lookups cost ~0.2s per returned element, so only the month headers are read to plan.
  private async monthHeaders(sessionId: string): Promise<MonthHeader[]> {
    return (await this.client.findAllWithFrames(sessionId, { predicate: "type == 'XCUIElementTypeStaticText' AND label BEGINSWITH 'Tháng '" }))
      .flatMap((item) => { const match = /^Tháng (\d+) - (\d+)$/.exec(item.label); return match ? [{ index: monthIndex(Number(match[2]), Number(match[1])), y: item.rect.y }] : []; });
  }

  // Drags stop where the finger lifts, so the whole distance goes out as one gesture.
  private async dragCalendar(sessionId: string, frame: ElementRect, offset: number) {
    if (!offset) return;
    const fingers: number[] = []; const step = AppiumClient.maxDrag(frame) - DRAG_SLOP;
    for (let rest = Math.abs(offset); rest > 0; rest -= Math.min(rest, step)) fingers.push(Math.min(rest, step) + DRAG_SLOP);
    await this.client.drags(sessionId, frame, offset > 0 ? 'down' : 'up', fingers);
  }

  // Exact labels resolve by accessibility id (~0.12s) instead of a predicate scan; false when the label is not on screen.
  private async tapExact(sessionId: string, label: string) {
    try { await this.client.tap(sessionId, await this.client.find(sessionId, { text: label })); return true; } catch { return false; }
  }
}

function value(input: unknown, variables: Record<string, unknown>) { return String(input ?? '').replace(/\{\{([\w.-]+)\}\}/g, (_match, key: string) => String(variables[key] ?? '')); }
function integer(input: unknown, variables: Record<string, unknown>, label: string) { const parsed = Number(value(input, variables)); if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} phải là số nguyên không âm.`); return parsed; }
function parseDate(input: string, label: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error(`${label} phải có dạng YYYY-MM-DD.`); const [year, month, day] = input.split('-').map(Number); const parsed = new Date(Date.UTC(year, month - 1, day)); if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error(`${label} không hợp lệ.`); return parsed; }
const DAY_MS = 86_400_000;
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function monthIndex(year: number, month: number) { return year * 12 + month - 1; }
// Calendar layout (Monday first): a 50px month header, then week rows every 44px with 40px-high day cells.
// Only used to plan the drag; the cell's real frame is checked before tapping.
const MONTH_HEADER = 50; const WEEK_ROW = 44; const DAY_CELL = 40;
function firstWeekday(index: number) { return (new Date(Date.UTC(Math.floor(index / 12), index % 12, 1)).getUTCDay() + 6) % 7; }
function monthHeight(index: number) { const days = new Date(Date.UTC(Math.floor(index / 12), index % 12 + 1, 0)).getUTCDate(); return MONTH_HEADER + WEEK_ROW * (Math.ceil((firstWeekday(index) + days) / 7) - 1) + DAY_CELL; }
// Pixels the content must move to bring the day's cell into view; positive means later months, 0 when already visible.
function offsetToDay(headers: MonthHeader[], date: Date, frame: ElementRect) {
  const target = monthIndex(date.getUTCFullYear(), date.getUTCMonth() + 1);
  if (!headers.length) return frame.height / 2;
  const reference = headers.reduce((best, header) => Math.abs(header.index - target) < Math.abs(best.index - target) ? header : best);
  let headerY = reference.y;
  for (let index = reference.index; index < target; index += 1) headerY += monthHeight(index);
  for (let index = reference.index; index > target; index -= 1) headerY -= monthHeight(index - 1);
  return offsetIntoView(headerY + MONTH_HEADER + WEEK_ROW * Math.floor((firstWeekday(target) + date.getUTCDate() - 1) / 7), DAY_CELL, frame);
}
function formatVietnameseMonth(date: Date) { return `Tháng ${date.getUTCMonth() + 1} - ${date.getUTCFullYear()}`; }
function xpathString(value: string | number) { return `'${String(value).replace(/'/g, "&apos;")}'`; }
