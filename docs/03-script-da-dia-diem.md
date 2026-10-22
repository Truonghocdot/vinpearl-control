# Script đa địa điểm

Module preview nhận 1–50 khách sạn, validate ngày và số khách, sau đó tạo workflow biến thể cho từng địa điểm theo thứ tự. Mỗi lần chạy dừng ở safe-stop trước booking/payment.

Input chỉ nhận `credentialRef`, mã thanh toán và danh sách địa điểm. `credentialRef` là metadata; secret thực tế chỉ được truy xuất từ macOS Keychain khi live engine được đưa vào queue sau khi selector profile WDA hoàn tất.

Live multi-device không chạy ở giai đoạn hiện tại. Trước khi mở nó, queue phải gắn mỗi location với một UDID, giữ per-device lock, tôn trọng concurrency Mac và reset Appium session giữa các location.
