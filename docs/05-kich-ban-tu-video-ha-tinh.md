# Kịch bản từ video MyVinpearl: Hà Tĩnh, dừng an toàn

Nguồn video dài khoảng 38 giây. Luồng bắt đầu tại trang chủ MyVinpearl đang có phiên đăng nhập; không có thao tác đăng nhập trong video.

## Input đọc được từ video

| Trường | Giá trị video | Biến campaign |
| --- | --- | --- |
| Năm thanh toán | `2027` | `paymentYear` |
| Từ khóa địa điểm | `ha tinh` | `locationQuery` |
| Khách sạn | `Vinpearl Ha Tinh Affiliated by Meliá` | `hotel` |
| Nhận phòng | 16/01/2027 | `checkIn` |
| Trả phòng | 17/01/2027 | `checkOut` |
| Phòng / người lớn / trẻ em / em bé | 1 / 1 / 0 / 0 | `rooms`, `adults`, `children`, `infants` |
| Loại phòng | `Deluxe King` (campaign mặc định `Deluxe Twin`) | `roomType` |
| Giá điểm | `20 điểm/đêm` | `roomPoints` |

Thông tin người đặt và khách trong video là dữ liệu cá nhân. Engine không hard-code hoặc đưa chúng vào log; chúng được lấy từ tài khoản đã chọn và Keychain khi live job bắt đầu.

## Thứ tự thực thi

1. Trang chủ → **Khách sạn**.
2. Chọn 1 phòng/1 người lớn, ngày 16–17/01/2027.
3. Mở **Không sử dụng điểm** → trong sheet **Chọn loại thanh toán** bấm ô mã căn nằm ngay dưới tiêu đề `Năm 2027` (video: `VBC-26-17`, mỗi tài khoản có mã khác). "Theo điểm" và "Năm 2027" chỉ là tiêu đề, bấm vào không đổi gì. Engine không phụ thuộc mã căn và xác minh sheet đã đóng, dropdown không còn "Không sử dụng điểm".
4. Tìm `ha tinh` → chọn **Vinpearl Ha Tinh Affiliated by Meliá** → nút **Tìm kiếm** (tiêu đề màn tìm kiếm cũng là "Tìm kiếm" nên phải nhắm vào Button).
5. Chờ giá thấp nhất `điểm/đêm` hiển thị rồi mới bấm **Xem phòng** (tap trong lúc màn đang push bị bỏ qua).
6. Danh sách phòng có nhiều loại phòng, mỗi loại một nút **Chọn phòng**. Video chọn **Deluxe King**; campaign dùng `roomType` (mặc định `Deluxe Twin`) và chỉ bấm nút trong block của loại phòng đó, sau khi kiểm tra `roomPoints` trong cùng block → **Đặt phòng** → **Tổng kết hành trình** hiển thị `Phòng 1: <roomType>`.
7. **Đặt ngay** → mở `Phòng 1: <roomType>` → chọn **Tôi là người đặt** → **Xong** → chờ bộ đếm `1/1` (icon checkbox không đổi accessibility name khi tick, nên `1/1` là bước xác minh).
8. **Tiếp tục** → **Đặt phòng của tôi**: điều khoản mặc định **chưa tick** và nút **Thanh toán** bị disable. Bấm icon checkbox, xác minh nút Thanh toán `enabled`, rồi bấm Button **Thanh toán** (thanh tiến trình cũng có nhãn "Thanh toán").
9. Chờ text **Xác nhận thanh toán** rồi dừng. App được giữ nguyên ở modal sau khi đóng session (`shouldTerminateApp=false`) để operator review.

## Safe stop bắt buộc

Campaign **không có thao tác bấm `Xác nhận`** trong modal `Xác nhận thanh toán`. Đây là điểm dừng cuối cùng. Chỉ operator được xem/review modal; không tạo giao dịch từ script này.

## UI hierarchy thực

Selector trong workflow đã được xác minh trên iPhone 12 mini (MyVinpearl, 10/2026): luồng chạy hết tới modal **Xác nhận thanh toán**. Các màn tham chiếu nằm trong thư mục `hierarchy/`. Nếu WDA trả lỗi *Developer App Certificate is not trusted*, trên iPhone cần vào **Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị**, chọn developer certificate đã ký `WebDriverAgentRunner`, rồi chọn **Tin cậy**. Sau đó trong app vào **Thiết bị → UI tree** để lưu XML màn hình hiện tại vào thư mục artifacts local.
