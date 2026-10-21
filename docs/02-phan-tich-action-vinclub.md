# Phân tích action từ video VinClub

## 1. Nguồn và giới hạn quan sát

- File nguồn: `1790884125566_6991080890982218842_6991080890982218842.mp4`.
- Thời lượng quan sát: khoảng 73 giây, màn hình dọc 720 x 1558, 24.5 FPS.
- Ứng dụng trên video: VinClub / MyVinpearl.
- Tài khoản trong video đã có email hiển thị sẵn; mật khẩu không được đưa vào script.
- Mốc thời gian dưới đây là xấp xỉ theo video, dùng để đối chiếu khi chạy lại trên thiết bị thật.

Video cho thấy thao tác UI trên iPhone. SSH một mình không thực hiện được các thao tác này. Workflow cần một `UIAutomationEngine` có khả năng mở app, tìm text/accessibility id, nhập liệu, chạm tọa độ và đọc trạng thái màn hình.

## 2. Luồng nghiệp vụ quan sát được

```text
Đăng nhập VinClub
  -> Trang chủ
  -> Khách sạn
  -> Chọn thanh toán Theo điểm / mã VEC-08-25
  -> Tìm Melia Vinpearl Da Nang Riverfront
  -> Chọn ngày nhận/trả phòng
  -> Chọn số phòng và số khách
  -> Tìm kiếm
  -> Xem chi tiết khách sạn
  -> Xem phòng
  -> Chọn phòng tiêu chuẩn
  -> Thử đặt phòng
  -> Nếu không đủ điểm: ghi nhận lỗi và dừng
```

## 3. Bảng action theo thời gian

| # | Mốc | Màn hình / hành động | Dữ liệu | Điều kiện thành công | Loại action |
| ---: | --- | --- | --- | --- | --- |
| 1 | 00:00–00:02 | Kiểm tra màn hình Đăng nhập | Email đã có sẵn; password là secret | Có tiêu đề `Đăng nhập` | `assertText`, `launchApp` |
| 2 | 00:01–00:03 | Chấp nhận điều khoản | Checkbox điều khoản | Checkbox được đánh dấu | `tapText`, `assertText` |
| 3 | 00:02–00:03 | Chấp nhận ưu đãi | Checkbox thông tin ưu đãi | Checkbox được đánh dấu | `tapText` |
| 4 | 00:03–00:05 | Đăng nhập | `{{username}}`, `{{password}}` | Có toast `Đăng nhập thành công` hoặc trang chủ | `inputText`, `tapText`, `waitForText` |
| 5 | 00:05–00:07 | Mở mục Khách sạn | Không có | Có tiêu đề `Tìm khách sạn` | `tapText`, `waitForText` |
| 6 | 00:08–00:14 | Mở lựa chọn thanh toán | Mặc định `Không sử dụng điểm` | Bottom sheet `Chọn loại thanh toán` xuất hiện | `tapText`, `waitForText` |
| 7 | 00:10–00:14 | Chọn thanh toán theo điểm | Chọn `Theo điểm`, mã `VEC-08-25`, năm 2026 | Trên form hiển thị `VEC-08-25` | `tapText`, `assertText` |
| 8 | 00:15–00:18 | Tìm địa điểm | Nhập `da` | Danh sách gợi ý xuất hiện | `tapText`, `inputText`, `waitForText` |
| 9 | 00:17–00:19 | Chọn khách sạn | `Melia Vinpearl Da Nang Riverfront` | Tên khách sạn nằm trong form | `tapText`, `assertText` |
| 10 | 00:20–00:27 | Chọn ngày | Lần 1: nhận 18/12/2026, trả 19/12/2026 | Form hiển thị `18` và `19`, `1 đêm` | `selectDate`, `assertText` |
| 11 | 00:28–00:30 | Chọn số phòng/khách | Lần 1: 1 phòng, 2 người lớn | Form hiển thị `1 Phòng`, `2 Người lớn` | `selectGuests`, `assertText` |
| 12 | 00:30–00:32 | Tìm kiếm phòng | Không có | Mở trang khách sạn | `tapText`, `waitForText` |
| 13 | 00:32–00:34 | Tải chi tiết khách sạn | Không có | Có tên khách sạn, địa chỉ và khu vực `Bản đồ` | `waitForText`, `assertText` |
| 14 | 00:34–00:35 | Mở danh sách phòng | Không có | Có tiêu đề `Danh sách phòng` | `tapText`, `waitForText` |
| 15 | 00:35–00:37 | Chọn phòng tiêu chuẩn | `Phòng tiêu chuẩn`, gói `VCBVCD` | Có giá `20 điểm/đêm` | `tapText`, `assertText` |
| 16 | 00:44–00:46 | Thử đặt phòng | Lần 1: 20 điểm | Hiện modal `Không đủ số điểm để thanh toán` | `tapText`, `waitForText` |
| 17 | 00:46–00:48 | Đóng lỗi nghiệp vụ | Nút `OK` | Modal đóng, vẫn ở danh sách phòng | `tapText`, `assertText` |
| 18 | 00:49–00:53 | Mở chi tiết khách sạn lần nữa | `Xem chi tiết` hoặc quay lại | Có khu vực `Bản đồ` và nút `Xem phòng` | `tapText`, `waitForText` |
| 19 | 00:54–00:57 | Quay về form tìm kiếm | Nút back | Có form `Tìm khách sạn` | `tapText`, `waitForText` |
| 20 | 00:55–00:58 | Kiểm tra lựa chọn điểm | `Theo điểm`, năm 2026, số dư 0 | Bottom sheet hiển thị số dư | `tapText`, `assertText` |
| 21 | 00:58–00:64 | Đổi ngày cho lần thử 2 | Nhận 17/12/2026, trả 18/12/2026 | Form hiển thị `17` và `18` | `selectDate`, `assertText` |
| 22 | 00:64–00:66 | Tìm kiếm lần 2 | Một phòng, một người lớn | Mở chi tiết khách sạn lần 2 | `tapText`, `waitForText` |
| 23 | 00:66–00:68 | Mở phòng lần 2 | Không đặt phòng | Có danh sách phòng | `tapText`, `waitForText` |
| 24 | 00:68–01:13 | Dừng an toàn | Không bấm `Đặt phòng` lần 2 | Workflow kết thúc ở danh sách phòng | `assertText`, `stop` |

## 4. Script workflow chuẩn hóa

Script này là dữ liệu workflow, không chứa password và không giả định tọa độ cố định. Adapter ưu tiên accessibility id/text; tọa độ chỉ là fallback khi app không cung cấp semantic selector.

```json
{
  "id": "vinclub-melia-room-search",
  "version": 1,
  "name": "VinClub - tìm phòng Melia Đà Nẵng",
  "variables": {
    "username": { "secret": false },
    "password": { "secret": true },
    "hotel": "Melia Vinpearl Da Nang Riverfront",
    "paymentPlan": "VEC-08-25",
    "checkIn": "2026-12-17",
    "checkOut": "2026-12-18",
    "adults": 1
  },
  "steps": [
    { "type": "launchApp", "name": "Mở VinClub" },
    { "type": "waitForText", "text": "Đăng nhập", "timeoutMs": 10000 },
    { "type": "inputText", "target": "Email / Số điện thoại", "value": "{{username}}" },
    { "type": "inputText", "target": "Mật khẩu", "value": "{{password}}", "secret": true },
    { "type": "tapText", "text": "Tôi đã đọc và đồng ý" },
    { "type": "tapText", "text": "Tôi đồng ý nhận các thông tin ưu đãi" },
    { "type": "tapText", "text": "Đăng nhập ngay" },
    { "type": "waitForText", "text": "Đăng nhập thành công", "timeoutMs": 15000 },
    { "type": "tapText", "text": "Khách sạn" },
    { "type": "waitForText", "text": "Tìm khách sạn" },
    { "type": "tapText", "text": "Không sử dụng điểm" },
    { "type": "tapText", "text": "Theo điểm" },
    { "type": "tapText", "text": "{{paymentPlan}}" },
    { "type": "tapText", "text": "Tìm địa điểm - khách sạn" },
    { "type": "inputText", "target": "Tìm kiếm", "value": "da" },
    { "type": "tapText", "text": "{{hotel}}" },
    { "type": "selectDate", "checkIn": "{{checkIn}}", "checkOut": "{{checkOut}}" },
    { "type": "selectGuests", "rooms": 1, "adults": "{{adults}}", "children": 0, "infants": 0 },
    { "type": "tapText", "text": "Tìm kiếm" },
    { "type": "waitForText", "text": "{{hotel}}", "timeoutMs": 20000 },
    { "type": "tapText", "text": "Xem phòng" },
    { "type": "waitForText", "text": "Danh sách phòng", "timeoutMs": 20000 },
    { "type": "tapText", "text": "Phòng tiêu chuẩn" },
    { "type": "assertText", "text": "20 điểm/đêm" },
    { "type": "stop", "reason": "Dừng trước Đặt phòng để tránh giao dịch ngoài ý muốn" }
  ]
}
```

## 5. Nhánh lỗi cần xử lý

### Không đủ điểm

Nếu operator chủ động chạy bước đặt phòng ở lần thử đầu, app phải chờ modal `Không đủ số điểm để thanh toán`, ghi log nghiệp vụ và dừng. Không tự động bấm `OK` rồi thử thanh toán lại.

### Tải dữ liệu chậm

Các màn hình chi tiết và danh sách phòng có trạng thái loading. Mỗi `waitForText` cần timeout; hết timeout thì job `failed` với ảnh chụp màn hình và màn hình cuối cùng.

### Selector thay đổi

Thứ tự ưu tiên: accessibility id, text chính xác, text chuẩn hóa không dấu, tọa độ fallback. Tọa độ từ video chỉ dùng để calibration, không hard-code làm selector duy nhất.

### Ngày hết hạn hoặc điểm thay đổi

Ngày trong video là dữ liệu mẫu. Khi chạy thực tế, workflow nên nhận `checkIn`/`checkOut` từ biến runtime và kiểm tra ngày còn khả dụng trước khi bấm xác nhận.

## 6. Feature cần triển khai trong ứng dụng

### Đã triển khai trong skeleton này

- Lưu workflow versioned trong SQLite.
- Hiển thị danh sách action theo thứ tự.
- Validate loại action và trường bắt buộc.
- Chạy thử workflow bằng preview adapter, có log từng action và trạng thái thành công/thất bại.
- Mask secret khi hiển thị log.
- Seed workflow VinClub theo script ở trên.

### Cần triển khai khi có engine iOS thật

- `UIAutomationEngine` qua agent trên iPhone hoặc công cụ tương thích.
- Accessibility tree dump và selector inspector.
- Screenshot lúc lỗi, retry theo step và cancel job.
- Credential store trên Windows; password không lưu trong workflow JSON.
- Chế độ phê duyệt riêng cho các action có thể tạo booking/payment.

## 7. Tiêu chí nghiệm thu workflow

- Preview chạy đủ 24 step và dừng ở `stop` trước `Đặt phòng`.
- Log không in password hoặc giá trị biến có `secret: true`.
- Thiếu selector, ngày hoặc số khách làm validate fail trước khi chạy.
- Workflow không được tự gọi UI iOS khi chỉ có SSH adapter.
- Khi adapter thật được tích hợp, phải test lại trên một tài khoản test và dừng trước giao dịch.

