import type { AppiumClient, AppiumElementSelector, AppiumSession } from './appium-client';
import type { WorkflowStep } from './workflow-runner';

export type VinClubSelectorProfile = {
  date: { open: AppiumElementSelector; calendar: AppiumElementSelector; dayInMonth: (monthLabel: string, day: number) => AppiumElementSelector; confirm: AppiumElementSelector };
  guests: { open: AppiumElementSelector; rooms: CounterSelector; adults: CounterSelector; children: CounterSelector; infants: CounterSelector; confirm: AppiumElementSelector };
};

type CounterSelector = { value: AppiumElementSelector; increment: AppiumElementSelector; decrement: AppiumElementSelector };

export const vinClubSelectorProfile: VinClubSelectorProfile = {
  date: {
    open: { xpath: "//XCUIElementTypeOther[XCUIElementTypeStaticText[@name='Nhận phòng']]//XCUIElementTypeButton[1]" },
    // The weekday row is also a collection view; the calendar is the one holding month headers.
    calendar: { xpath: "//XCUIElementTypeCollectionView[XCUIElementTypeOther[XCUIElementTypeStaticText[starts-with(@name, 'Tháng ')]]]" },
    // The day is scoped to the immediately preceding month header, so identical days in adjacent months cannot collide.
    dayInMonth: (monthLabel, day) => ({ xpath: `//XCUIElementTypeCell[XCUIElementTypeStaticText[@name=${xpathString(day)}] and preceding-sibling::XCUIElementTypeOther[1][XCUIElementTypeStaticText[@name=${xpathString(monthLabel)}]]]` }),
    confirm: { predicate: "name BEGINSWITH 'Xác nhận'" },
  },
  guests: {
    open: { xpath: "//XCUIElementTypeOther[XCUIElementTypeStaticText[contains(@name, 'Phòng')]]//XCUIElementTypeButton[1]" },
    rooms: {
      value: { xpath: "//XCUIElementTypeStaticText[@name='Số lượng phòng']/following-sibling::XCUIElementTypeOther//XCUIElementTypeStaticText[1]" },
      increment: { xpath: "//XCUIElementTypeStaticText[@name='Số lượng phòng']/following-sibling::XCUIElementTypeOther//XCUIElementTypeButton[@name='button add active']" },
      decrement: { xpath: "//XCUIElementTypeStaticText[@name='Số lượng phòng']/following-sibling::XCUIElementTypeOther//XCUIElementTypeButton[@name='button minus enable']" },
    },
    adults: counter({ xpath: "//XCUIElementTypeStaticText[@name='Người lớn']/following-sibling::XCUIElementTypeStaticText[5]" }, 1, 6),
    children: counter({ xpath: "//XCUIElementTypeStaticText[@name='Trẻ em']/following-sibling::XCUIElementTypeStaticText[5]" }, 3, 2),
    infants: counter({ xpath: "//XCUIElementTypeStaticText[@name='Em bé']/following-sibling::XCUIElementTypeStaticText[4]" }, 5, 4),
    confirm: { predicate: "name BEGINSWITH 'Xác nhận ('" },
  },
};

// The guest controls have no unique IDs. These positions are semantic child positions in the room cell, not screen coordinates.
function counter(value: AppiumElementSelector, increment: number, decrement: number): CounterSelector {
  const cell = '**/XCUIElementTypeTable/XCUIElementTypeCell[1]';
  return {
    value,
    increment: { classChain: `${cell}/XCUIElementTypeButton[${increment}]` },
    decrement: { classChain: `${cell}/XCUIElementTypeButton[${decrement}]` },
  };
}

export class VinClubActionAdapter {
  constructor(private readonly client: AppiumClient, private readonly profile: VinClubSelectorProfile = vinClubSelectorProfile) {}

  async execute(session: AppiumSession, step: WorkflowStep, variables: Record<string, unknown>) {
    if (step.type === 'selectDate') return this.selectDate(session, value(step.checkIn, variables), value(step.checkOut, variables));
    if (step.type === 'selectGuests') return this.selectGuests(session, {
      rooms: integer(step.rooms, variables, 'rooms'), adults: integer(step.adults, variables, 'adults'), children: integer(step.children, variables, 'children'), infants: integer(step.infants, variables, 'infants'),
    });
    throw new Error(`VinClub adapter không hỗ trợ ${step.type}.`);
  }

  private async selectGuests(session: AppiumSession, target: { rooms: number; adults: number; children: number; infants: number }) {
    await this.client.click(session.id, this.profile.guests.open);
    await this.adjust(session.id, this.profile.guests.rooms, target.rooms, 'phòng');
    await this.adjust(session.id, this.profile.guests.adults, target.adults, 'người lớn');
    await this.adjust(session.id, this.profile.guests.children, target.children, 'trẻ em');
    await this.adjust(session.id, this.profile.guests.infants, target.infants, 'em bé');
    await this.client.click(session.id, this.profile.guests.confirm);
  }

  private async adjust(sessionId: string, counter: CounterSelector, target: number, label: string) {
    let current = Number.parseInt(await this.client.text(sessionId, counter.value), 10);
    if (!Number.isInteger(current)) throw new Error(`Không đọc được số ${label} hiện tại.`);
    const delta = target - current; const selector = delta >= 0 ? counter.increment : counter.decrement;
    for (let index = 0; index < Math.abs(delta); index += 1) {
      await this.client.click(sessionId, selector);
      current = Number.parseInt(await this.client.text(sessionId, counter.value), 10);
      const expected = delta >= 0 ? target - (Math.abs(delta) - index - 1) : target + (Math.abs(delta) - index - 1);
      if (current !== expected) throw new Error(`Không cập nhật được ${label} tới ${target}.`);
    }
  }

  private async selectDate(session: AppiumSession, checkIn: string, checkOut: string) {
    const start = parseDate(checkIn, 'checkIn'); const end = parseDate(checkOut, 'checkOut');
    if (end <= start) throw new Error('checkOut phải sau checkIn.');
    await this.client.click(session.id, this.profile.date.open);
    await this.pickDay(session.id, start);
    await this.pickDay(session.id, end);
    await this.client.click(session.id, this.profile.date.confirm);
  }

  // Header labels and positions without reading the whole calendar tree (~1.7s per page source).
  private async monthHeaders(sessionId: string) {
    const elements = await this.client.findAll(sessionId, { predicate: "type == 'XCUIElementTypeStaticText' AND name BEGINSWITH 'Tháng '" });
    const headers = await Promise.all(elements.map(async (element) => ({ label: await this.client.attribute(sessionId, element, 'name'), rect: await this.client.rect(sessionId, element) })));
    return headers.flatMap(({ label, rect }) => { const match = /^Tháng (\d+) - (\d+)$/.exec(label); return match ? [{ index: monthIndex(Number(match[2]), Number(match[1])), y: rect.y }] : []; });
  }

  private async pickDay(sessionId: string, date: Date) {
    const monthLabel = formatVietnameseMonth(date);
    const day = this.profile.date.dayInMonth(monthLabel, date.getUTCDate());
    const calendar = await this.client.find(sessionId, this.profile.date.calendar);
    const frame = await this.client.rect(sessionId, calendar);
    const target = monthIndex(date.getUTCFullYear(), date.getUTCMonth() + 1);
    // Drags carry unpredictable momentum, so re-read header positions after each drag and correct in either direction.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try { const element = await this.client.find(sessionId, day); if (await this.client.attribute(sessionId, element, 'visible') === 'true') { await this.client.tap(sessionId, element); return; } } catch { /* Month not laid out or day row below the fold. */ }
      const offset = offsetToMonth(await this.monthHeaders(sessionId), target, frame.y + 8);
      // Observed momentum roughly doubles the finger travel.
      await this.client.scroll(sessionId, offset > 0 ? 'down' : 'up', calendar, Math.min(0.7, Math.max(0.1, Math.abs(offset) / 2 / frame.height)));
    }
    throw new Error(`Không tìm thấy ngày ${date.getUTCDate()} trong ${monthLabel}.`);
  }
}

function value(input: unknown, variables: Record<string, unknown>) { return String(input ?? '').replace(/\{\{([\w.-]+)\}\}/g, (_match, key: string) => String(variables[key] ?? '')); }
function integer(input: unknown, variables: Record<string, unknown>, label: string) { const parsed = Number(value(input, variables)); if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} phải là số nguyên không âm.`); return parsed; }
function parseDate(input: string, label: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error(`${label} phải có dạng YYYY-MM-DD.`); const [year, month, day] = input.split('-').map(Number); const parsed = new Date(Date.UTC(year, month - 1, day)); if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error(`${label} không hợp lệ.`); return parsed; }
function monthIndex(year: number, month: number) { return year * 12 + month - 1; }
// Pixels the content must move so the target header sits at anchorY; positive means later months.
function offsetToMonth(headers: Array<{ index: number; y: number }>, target: number, anchorY: number) {
  if (!headers.length) return 300;
  const sorted = [...headers].sort((left, right) => left.index - right.index);
  const spacing = sorted.length > 1 ? (sorted.at(-1)!.y - sorted[0].y) / (sorted.at(-1)!.index - sorted[0].index) : 266;
  const reference = sorted.reduce((best, header) => Math.abs(header.index - target) < Math.abs(best.index - target) ? header : best);
  return reference.y + (target - reference.index) * spacing - anchorY;
}
function formatVietnameseMonth(date: Date) { return `Tháng ${date.getUTCMonth() + 1} - ${date.getUTCFullYear()}`; }
function xpathString(value: string | number) { return `'${String(value).replace(/'/g, "&apos;")}'`; }
