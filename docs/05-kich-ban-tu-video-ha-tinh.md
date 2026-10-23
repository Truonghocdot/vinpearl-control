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

Thông tin người đặt và khách trong video là dữ liệu cá nhân. Engine không hard-code hoặc đưa chúng vào log; chúng được lấy từ hồ sơ của tài khoản đang đăng nhập trên iPhone (chọn **Tôi là người đặt**).

## Thứ tự thực thi

1. Trang chủ → **Khách sạn**.
2. Số khách: đọc 4 nhãn trên form ("1 Phòng", "2 Người lớn", "0 Trẻ em", "0 Em bé") trong một lệnh; nếu đã đúng thì bỏ qua sheet, nếu lệch thì mở sheet, bấm +/− đúng số lần và xác nhận bằng nhãn chính xác `Xác nhận (1 phòng, 1 khách)` (nhãn khớp nghĩa là bộ đếm đúng). Ngày: chỉ chạm ngày nhận phòng 16/01/2027, app tự đặt 1 đêm (`Xác nhận 1 đêm`); ngày trả phòng chỉ được chạm khi campaign đặt từ 2 đêm. Lịch mở bằng cách chạm chữ "Nhận phòng" và luôn mở ở tháng hiện tại, nên engine chỉ tìm tiêu đề tháng hiện tại kèm vị trí (nếu không thấy thì đọc mọi tiêu đề "Tháng …" đang hiện) và tính vị trí ô ngày theo bố cục lịch (tuần bắt đầu Thứ 2, tiêu đề tháng 50px, mỗi tuần 44px), rồi chỉ cuộn vừa đủ để hàng chứa ngày đó lọt vào lịch (16/01/2027 từ tháng 10: một cú kéo). Cú kéo đi ~1px/ms và kết thúc bằng đoạn kéo chậm nên lịch dừng ngay, không trôi (lịch tái sử dụng ô khi đang trôi, chạm lúc đó có thể chọn nhầm ngày). Ô ngày được tìm kèm khung khi lịch đã đứng yên; nếu ô bị thanh dưới che một phần thì kéo thêm một đoạn ngắn rồi mới chạm (chạm vào đó sẽ thành bấm nút xác nhận), rồi bấm nút có nhãn chính xác `Xác nhận 1 đêm` (nhãn khớp nghĩa là số đêm đúng); engine không đọc lại ngày trên form.
3. Mở **Không sử dụng điểm** → trong sheet **Chọn loại thanh toán** bấm ô mã căn nằm ngay dưới tiêu đề `Năm 2027` (video: `VBC-26-17`, mỗi tài khoản có mã khác). "Theo điểm" và "Năm 2027" chỉ là tiêu đề, bấm vào không đổi gì. Engine không phụ thuộc mã căn và xác minh sheet đã đóng, dropdown không còn "Không sử dụng điểm".
4. Tìm `ha tinh` → chọn **Vinpearl Ha Tinh Affiliated by Meliá** → nút **Tìm kiếm** (tiêu đề màn tìm kiếm cũng là "Tìm kiếm" nên phải nhắm vào Button).
5. Bấm **Xem phòng** khi nút đã `enabled`: nút hiện ngay nhưng bị disable (kèm vòng xoay) trong lúc tải giá, chạm lúc đó bị bỏ qua. Nếu sau 2 giây chưa thấy **Danh sách phòng** thì bấm lại.
6. Danh sách phòng có nhiều loại phòng, mỗi loại một nút **Chọn phòng**. Video chọn **Deluxe King**; campaign dùng `roomType` (mặc định `Deluxe Twin`) và chỉ bấm nút **Chọn phòng** nằm trong ô giá của loại phòng đó có hiển thị `roomPoints` (giá đổi thì bước này lỗi thay vì chọn phòng giá khác) → **Đặt phòng** → **Tổng kết hành trình**.
7. **Đặt ngay** → mở `Phòng 1: <roomType>` (chọn dòng có số khách "… người lớn" của trang Thông tin người đặt; trang tổng kết đang trượt ra cũng có nhãn này, cạnh số điểm) → chọn **Tôi là người đặt** → **Xong** → chờ bộ đếm `1/1` (icon checkbox không đổi accessibility name khi tick, nên `1/1` là bước xác minh).
8. **Tiếp tục** → **Đặt phòng của tôi**: điều khoản mặc định **chưa tick** và nút **Thanh toán** bị disable. Bấm icon checkbox, xác minh nút Thanh toán `enabled`, rồi bấm Button **Thanh toán** (thanh tiến trình cũng có nhãn "Thanh toán").
9. Chờ text **Xác nhận thanh toán** rồi dừng. App được giữ nguyên ở modal sau khi đóng session (`shouldTerminateApp=false`) để operator review.

## Safe stop bắt buộc

Campaign **không có thao tác bấm `Xác nhận`** trong modal `Xác nhận thanh toán`. Đây là điểm dừng cuối cùng. Chỉ operator được xem/review modal; không tạo giao dịch từ script này.

## UI hierarchy thực

Selector trong workflow đã được xác minh trên iPhone 12 mini (MyVinpearl, 10/2026): luồng chạy hết tới modal **Xác nhận thanh toán**. Các màn tham chiếu nằm trong thư mục `hierarchy/`. Nếu WDA trả lỗi *Developer App Certificate is not trusted*, trên iPhone cần vào **Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị**, chọn developer certificate đã ký `WebDriverAgentRunner`, rồi chọn **Tin cậy**. Sau đó trong app vào **Thiết bị → UI tree** để lưu XML màn hình hiện tại vào thư mục artifacts local.
