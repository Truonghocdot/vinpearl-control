import type { WorkflowDefinition } from './workflow-runner';

export const BOOKING_FLOW_ID = 'vinclub-safe-booking';

// Owner-code cell directly after the "Năm YYYY" header in the "Chọn loại thanh toán" sheet.
const PAYMENT_YEAR_CODE = "//XCUIElementTypeOther[XCUIElementTypeStaticText[@name='Năm {{paymentYear}}']]/following-sibling::XCUIElementTypeCell[1]";
// Room list sections are a header named after the room type followed by its rate cells.
const ROOM_RATE = "//XCUIElementTypeTable/XCUIElementTypeOther[@name='{{roomType}}']/following-sibling::XCUIElementTypeCell[1]";
// Room images push later room types below the fold once they load.
const ROOM_LIST = '//XCUIElementTypeTable';
const PAYMENT_ENABLED = "//XCUIElementTypeButton[@name='Thanh toán' and @enabled='true']";
const TERMS = "XCUIElementTypeButton[starts-with(@name, 'Tôi đồng ý với các điều khoản')]";

export const vinClubWorkflow: WorkflowDefinition = {
  id: BOOKING_FLOW_ID,
  version: 10,
  name: 'MyVinpearl - booking an toàn trước xác nhận thanh toán',
  description: 'Kịch bản booking cố định: tìm khách sạn, chọn phòng và hoàn tất thông tin; dừng trước nút Xác nhận trong modal thanh toán.',
  bundleId: 'net.cloudhms.booking.vinpearl',
  variables: {
    paymentYear: 2027, locationQuery: 'ha tinh', hotel: 'Vinpearl Ha Tinh Affiliated by Meliá', checkIn: '2027-01-16', checkOut: '2027-01-17', rooms: 1, adults: 1, children: 0, infants: 0, roomType: 'Deluxe Twin', roomPoints: '20 điểm/đêm',
  },
  steps: [
    { type: 'launchApp', name: 'Mở MyVinpearl' },
    { type: 'ensureHome', name: 'Mở trang chủ hoặc đăng nhập', timeoutMs: 30_000 },
    { type: 'tapText', name: 'Mở khách sạn', text: 'Khách sạn' },
    { type: 'waitForText', name: 'Chờ form tìm khách sạn', text: 'Tìm khách sạn', timeoutMs: 15_000 },
    { type: 'selectGuests', name: 'Chọn 1 phòng, 1 người lớn', rooms: '{{rooms}}', adults: '{{adults}}', children: '{{children}}', infants: '{{infants}}' },
    { type: 'selectDate', name: 'Chọn nhận/trả phòng', checkIn: '{{checkIn}}', checkOut: '{{checkOut}}' },
    { type: 'tapText', name: 'Mở loại thanh toán', text: 'Không sử dụng điểm' },
    { type: 'waitForText', name: 'Chờ chọn loại thanh toán', text: 'Chọn loại thanh toán', timeoutMs: 10_000 },
    // "Theo điểm" and "Năm YYYY" are headers; only the owner-code cell under the year header switches to points.
    { type: 'tapText', name: 'Chọn mã căn của năm thanh toán', text: 'Năm {{paymentYear}}', xpath: PAYMENT_YEAR_CODE, timeoutMs: 15_000 },
    { type: 'waitForText', name: 'Kiểm tra đã chuyển sang dùng điểm', text: 'Năm {{paymentYear}}', xpath: "//XCUIElementTypeApplication[not(.//XCUIElementTypeStaticText[@name='Chọn loại thanh toán']) and not(.//XCUIElementTypeStaticText[@name='Không sử dụng điểm'])]", timeoutMs: 10_000 },
    { type: 'tapText', name: 'Mở tìm địa điểm', text: 'Tìm địa điểm - khách sạn', xpath: "//XCUIElementTypeOther[./XCUIElementTypeStaticText[@name='Tìm địa điểm - khách sạn']]/XCUIElementTypeButton" },
    { type: 'waitForText', name: 'Chờ ô tìm kiếm địa điểm', text: 'Tìm địa điểm hoặc khách sạn', xpath: "//XCUIElementTypeTextField[@placeholderValue='Tìm địa điểm hoặc khách sạn']", timeoutMs: 10_000 },
    { type: 'inputText', name: 'Nhập địa điểm', target: 'Tìm địa điểm hoặc khách sạn', xpath: "//XCUIElementTypeTextField[@placeholderValue='Tìm địa điểm hoặc khách sạn']", value: '{{locationQuery}}' },
    { type: 'waitForText', name: 'Chờ kết quả khách sạn', text: '{{hotel}}', timeoutMs: 15_000 },
    { type: 'tapText', name: 'Chọn khách sạn', text: '{{hotel}}' },
    // The search screen's title is also "Tìm kiếm", so target the form button.
    { type: 'tapText', name: 'Tìm phòng', text: 'Tìm kiếm', xpath: "//XCUIElementTypeButton[@name='Tìm kiếm']" },
    { type: 'waitForText', name: 'Chờ chi tiết khách sạn', text: '{{hotel}}', xpath: "//XCUIElementTypeNavigationBar[@name='{{hotel}}']", timeoutMs: 25_000 },
    // A tap during the push animation is dropped; the loaded lowest price means the page is interactive.
    { type: 'waitForText', name: 'Chờ giá thấp nhất', text: 'điểm/đêm', timeoutMs: 25_000 },
    { type: 'tapText', name: 'Mở phòng', text: 'Xem phòng', until: 'Danh sách phòng', timeoutMs: 20_000 },
    { type: 'waitForText', name: 'Chờ danh sách phòng', text: 'Danh sách phòng', timeoutMs: 25_000 },
    { type: 'waitForText', name: 'Kiểm tra điểm của loại phòng', text: '{{roomType}} {{roomPoints}}', xpath: `${ROOM_RATE}/XCUIElementTypeStaticText[@name='{{roomPoints}}']`, scrollContainer: ROOM_LIST, timeoutMs: 20_000 },
    { type: 'tapText', name: 'Chọn phòng theo loại phòng input', text: 'Chọn phòng', xpath: `${ROOM_RATE}//XCUIElementTypeButton[@name='Chọn phòng']`, scrollContainer: ROOM_LIST },
    { type: 'tapText', name: 'Tiếp tục sau khi chọn phòng', text: 'Đặt phòng', xpath: "//XCUIElementTypeButton[@name='Đặt phòng']" },
    { type: 'waitForText', name: 'Chờ tổng kết hành trình', text: 'Tổng kết hành trình', timeoutMs: 15_000 },
    { type: 'assertText', name: 'Kiểm tra phòng đã chọn', text: 'Phòng 1: {{roomType}}' },
    { type: 'tapText', name: 'Đặt ngay', text: 'Đặt ngay' },
    { type: 'waitForText', name: 'Chờ thông tin người đặt', text: 'Thông tin người đặt', timeoutMs: 15_000 },
    { type: 'tapText', name: 'Mở thông tin khách phòng 1', text: 'Phòng 1: {{roomType}}' },
    { type: 'waitForText', name: 'Chờ thông tin khách', text: 'Nhập thông tin khách', timeoutMs: 10_000 },
    // The checkbox image keeps its accessibility name when ticked; the "1/1" guest counter below verifies the result.
    { type: 'tapText', name: 'Dùng thông tin người đặt', text: 'Tôi là người đặt', xpath: "//XCUIElementTypeOther[XCUIElementTypeStaticText[@name='Tôi là người đặt']]/XCUIElementTypeButton" },
    { type: 'tapText', name: 'Lưu thông tin khách', text: 'Xong' },
    { type: 'waitForText', name: 'Xác nhận đủ khách', text: '1/1', timeoutMs: 10_000 },
    { type: 'tapText', name: 'Tiếp tục đến trang xác nhận', text: 'Tiếp tục' },
    { type: 'waitForText', name: 'Chờ trang xác nhận', text: 'Đặt phòng của tôi', timeoutMs: 15_000 },
    // Tap the checkbox icon itself: the row center is the terms link text. The icon keeps its name when ticked,
    // so the enabled "Thanh toán" button is the verification (and the retry signal).
    { type: 'tapText', name: 'Đồng ý điều khoản', text: 'Tôi đồng ý với các điều khoản, điều kiện và chính sách quyền riêng tư của Vinpearl.', xpath: `//XCUIElementTypeOther[${TERMS}]/XCUIElementTypeImage[@name='ic_uncheck']`, tapCenter: true, until: PAYMENT_ENABLED, timeoutMs: 20_000 },
    { type: 'waitForText', name: 'Kiểm tra đã đồng ý điều khoản', text: 'Thanh toán', xpath: PAYMENT_ENABLED, timeoutMs: 5_000 },
    // The progress header also has a "Thanh toán" label, so target the button.
    { type: 'tapText', name: 'Mở xác nhận thanh toán', text: 'Thanh toán', xpath: "//XCUIElementTypeButton[@name='Thanh toán']" },
    { type: 'waitForText', name: 'Chờ modal xác nhận thanh toán', text: 'Xác nhận thanh toán', timeoutMs: 10_000 },
    { type: 'stop', name: 'Dừng trước xác nhận cuối cùng', reason: 'Modal xác nhận thanh toán đã hiển thị. Không bấm Xác nhận, không tạo giao dịch.' },
  ],
};
