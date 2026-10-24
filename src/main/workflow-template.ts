import type { WorkflowDefinition } from './workflow-runner';

export const BOOKING_FLOW_ID = 'vinclub-safe-booking';

// Owner-code cell directly after the "Năm YYYY" header in the "Chọn loại thanh toán" sheet.
const PAYMENT_YEAR_CODE = "//XCUIElementTypeOther[XCUIElementTypeStaticText[@name='Năm {{paymentYear}}']]/following-sibling::XCUIElementTypeCell[1]";
// Room list sections are a header named after the room type followed by its rate cells.
const ROOM_RATE = "//XCUIElementTypeTable/XCUIElementTypeOther[@name='{{roomType}}']/following-sibling::XCUIElementTypeCell[1]";
// Room images push later room types below the fold once they load.
const ROOM_LIST = '//XCUIElementTypeTable';
// Predicates for plain type + name matches: ~25% cheaper than the equivalent xpath.
const PAYMENT_ENABLED = "type == 'XCUIElementTypeButton' AND name == 'Thanh toán' AND enabled == true";
// The sheet is closed and the dropdown no longer says "Không sử dụng điểm" once an owner code is chosen.
const PAYMENT_BY_POINTS = "//XCUIElementTypeApplication[not(.//XCUIElementTypeStaticText[@name='Chọn loại thanh toán']) and not(.//XCUIElementTypeStaticText[@name='Không sử dụng điểm'])]";
const SEARCH_FIELD = "type == 'XCUIElementTypeTextField' AND placeholderValue == 'Tìm địa điểm hoặc khách sạn'";
const SEARCH_BUTTON = "type == 'XCUIElementTypeButton' AND name == 'Tìm kiếm'";
// Appears in the footer once a rate is selected.
const BOOK_BUTTON = "type == 'XCUIElementTypeButton' AND name == 'Đặt phòng'";
const BOOKER_TOGGLE = "//XCUIElementTypeOther[XCUIElementTypeStaticText[@name='Tôi là người đặt']]/XCUIElementTypeButton";
// An empty guest field shows its placeholder as its value; ticking "Tôi là người đặt" fills it from the account profile.
const GUEST_FILLED = "//XCUIElementTypeScrollView[.//XCUIElementTypeStaticText[@name='Tôi là người đặt']]//XCUIElementTypeTextField[@placeholderValue='Họ (không dấu)' and @value!='Họ (không dấu)']";
const TERMS = "XCUIElementTypeButton[starts-with(@name, 'Tôi đồng ý với các điều khoản')]";

export const vinClubWorkflow: WorkflowDefinition = {
  id: BOOKING_FLOW_ID,
  version: 16,
  name: 'MyVinpearl - booking an toàn trước xác nhận thanh toán',
  description: 'Kịch bản booking cố định: tìm khách sạn, chọn phòng và hoàn tất thông tin; dừng trước nút Xác nhận trong modal thanh toán.',
  bundleId: 'net.cloudhms.booking.vinpearl',
  variables: {
    paymentYear: 2027, locationQuery: 'ha tinh', hotel: 'Vinpearl Ha Tinh Affiliated by Meliá', checkIn: '2027-01-16', checkOut: '2027-01-17', rooms: 1, adults: 1, children: 0, infants: 0, roomType: 'Deluxe Twin', roomPoints: '20 điểm/đêm',
  },
  // `capture` marks the milestones photographed during test runs (dates, payment, room, guests, final modal).
  steps: [
    { type: 'launchApp', name: 'Mở MyVinpearl' },
    { type: 'ensureHome', name: 'Chờ trang chủ (thiết bị đã đăng nhập sẵn)', timeoutMs: 30_000 },
    // Taps right after the home screen loads can be dropped on slower iPhones (iPhone 7); the search form's date label confirms it.
    { type: 'tapText', name: 'Mở khách sạn', text: 'Khách sạn', until: 'Nhận phòng' },
    { type: 'selectGuests', name: 'Chọn 1 phòng, 1 người lớn', rooms: '{{rooms}}', adults: '{{adults}}', children: '{{children}}', infants: '{{infants}}' },
    { type: 'selectDate', name: 'Chọn nhận/trả phòng', checkIn: '{{checkIn}}', checkOut: '{{checkOut}}', capture: true },
    // No standalone wait/assert steps: every tap waits for its own target, and `until` checks the result (re-tapping when a tap
    // lands mid-transition) and hands the element it found to the next step when that step acts on it.
    // `settle` waits for the target to stop moving; only the taps that follow a slide-in need it (otherwise dropped, ~3s retry).
    // Once (1 of ~10 runs) the dropdown stayed unreachable for >10s after the calendar closed, so this wait is longer.
    { type: 'tapText', name: 'Mở loại thanh toán', text: 'Không sử dụng điểm', timeoutMs: 20_000 },
    // "Theo điểm" and "Năm YYYY" are headers; only the owner-code cell under the year header switches to points.
    { type: 'tapText', name: 'Chọn mã căn của năm thanh toán', text: 'Năm {{paymentYear}}', xpath: PAYMENT_YEAR_CODE, settle: true, until: PAYMENT_BY_POINTS, timeoutMs: 15_000, capture: true },
    { type: 'tapText', name: 'Mở tìm địa điểm', text: 'Tìm địa điểm - khách sạn', xpath: "//XCUIElementTypeOther[./XCUIElementTypeStaticText[@name='Tìm địa điểm - khách sạn']]/XCUIElementTypeButton", until: SEARCH_FIELD },
    { type: 'inputText', name: 'Nhập địa điểm', target: 'Tìm địa điểm hoặc khách sạn', predicate: SEARCH_FIELD, value: '{{locationQuery}}' },
    // Results reload while typing, so a tap can hit a list being replaced; retry until the form's search button is back.
    // The search screen's title is also "Tìm kiếm", so the form is identified by its button.
    { type: 'tapText', name: 'Chọn khách sạn', text: '{{hotel}}', xpath: "//XCUIElementTypeCell[XCUIElementTypeStaticText[@name='{{hotel}}']]", until: SEARCH_BUTTON, timeoutMs: 15_000 },
    { type: 'tapText', name: 'Tìm phòng', text: 'Tìm kiếm', predicate: SEARCH_BUTTON },
    // The button is on screen but disabled while the price loads; a tap then is ignored.
    { type: 'tapText', name: 'Mở phòng', text: 'Xem phòng', predicate: "type == 'XCUIElementTypeButton' AND name == 'Xem phòng' AND enabled == true", until: 'Danh sách phòng', timeoutMs: 25_000 },
    // The button only matches inside a rate cell showing `roomPoints`, so a price change fails here instead of booking it.
    { type: 'tapText', name: 'Chọn phòng theo loại phòng và điểm', text: 'Chọn phòng', xpath: `${ROOM_RATE}[XCUIElementTypeStaticText[@name='{{roomPoints}}']]//XCUIElementTypeButton[@name='Chọn phòng']`, scrollContainer: ROOM_LIST, until: BOOK_BUTTON, timeoutMs: 20_000, capture: true },
    { type: 'tapText', name: 'Tiếp tục sau khi chọn phòng', text: 'Đặt phòng', predicate: BOOK_BUTTON },
    { type: 'tapText', name: 'Đặt ngay', text: 'Đặt ngay' },
    // "Phòng 1: …" is also on the outgoing summary page (next to the points); the booker page's row lists the guests.
    { type: 'tapText', name: 'Mở thông tin khách phòng 1', text: 'Phòng 1: {{roomType}}', xpath: "//XCUIElementTypeCell[XCUIElementTypeStaticText[contains(@name, 'người lớn')]]/XCUIElementTypeStaticText[@name='Phòng 1: {{roomType}}']", settle: true, until: BOOKER_TOGGLE, timeoutMs: 15_000 },
    // The toggle is in the tree while the sheet still slides up, and a tap then is dropped; "Xong" would close the sheet with
    // the guest list still 0/1. The checkbox image keeps its accessibility name when ticked, so the filled name field verifies it.
    { type: 'tapText', name: 'Dùng thông tin người đặt', text: 'Tôi là người đặt', xpath: BOOKER_TOGGLE, settle: true, until: GUEST_FILLED, skipIfUntil: true },
    { type: 'tapText', name: 'Lưu thông tin khách', text: 'Xong', until: '1/1', capture: true },
    { type: 'tapText', name: 'Tiếp tục đến trang xác nhận', text: 'Tiếp tục' },
    // Tap the checkbox icon itself: the row center is the terms link text. The icon keeps its name when ticked,
    // so the enabled "Thanh toán" button is the verification. The app remembers acceptance per account, so skip the tap when already enabled.
    { type: 'tapText', name: 'Đồng ý điều khoản', text: 'Tôi đồng ý với các điều khoản, điều kiện và chính sách quyền riêng tư của Vinpearl.', xpath: `//XCUIElementTypeOther[${TERMS}]/XCUIElementTypeImage[@name='ic_uncheck']`, tapCenter: true, until: PAYMENT_ENABLED, skipIfUntil: true, timeoutMs: 20_000 },
    // The progress header also has a "Thanh toán" label, so target the button (the one the terms step found is handed over).
    { type: 'tapText', name: 'Mở xác nhận thanh toán', text: 'Thanh toán', predicate: PAYMENT_ENABLED },
    { type: 'waitForText', name: 'Chờ modal xác nhận thanh toán', text: 'Xác nhận thanh toán', timeoutMs: 10_000, capture: true },
    { type: 'stop', name: 'Dừng trước xác nhận cuối cùng', reason: 'Modal xác nhận thanh toán đã hiển thị. Không bấm Xác nhận, không tạo giao dịch.' },
  ],
};
