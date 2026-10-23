# Action VinClub và selector profile

Engine booking cố định mở VinClub (thiết bị đã đăng nhập sẵn, engine không tự đăng nhập), tìm khách sạn, chọn ngày/số khách, kiểm tra giá phòng rồi dừng an toàn trước thao tác đặt phòng. Campaign chỉ cung cấp input, không chứa password.

## Quy tắc selector

1. Accessibility id.
2. iOS predicate theo `label` hoặc `name` chính xác.
3. Selector profile đã normalize sau khi kiểm tra accessibility tree.

Không dùng tọa độ touch làm selector production. Mỗi bản VinClub cần được spike lại nếu tree hoặc nội dung UI đổi.

## Capability hiện có

`launchApp`, `waitForText`, `tapText`, `inputText`, `assertText` và `screenshot` gọi primitive Appium/XCUITest. `tapText` chờ element xuất hiện (mặc định 10 giây hoặc `timeoutMs` của step) rồi mới chạm. Với `until`, engine kiểm tra kết quả sau khi chạm, chạm lại nếu tap bị bỏ qua và chuyển element tìm được cho step kế tiếp (không tìm lại). `settle` (chờ element đứng yên trước khi chạm) chỉ bật cho các tap ngay sau hiệu ứng trượt: mã căn, Phòng 1. Nút chỉ bấm được khi tải xong (Xem phòng, Thanh toán) được chờ bằng predicate `enabled == true`. Selector chỉ gồm type + name dùng iOS predicate (rẻ hơn xpath ~25%); `until` nhận xpath (`/…`), predicate (`… == …`) hoặc text. Kịch bản không có step chỉ để chờ hoặc assert. Runner cho mỗi step thêm 5 giây so với `timeoutMs` để lỗi selector cụ thể được báo trước khi hết thời gian của step. `selectDate` và `selectGuests` dùng macro selector profile từ cây WDA đã capture: counter theo cấu trúc cell số khách, lịch cuộn theo tiêu đề tháng rồi chọn ngày trong đúng block tháng.

## Safety

Live job không đọc password: MyVinpearl phải được đăng nhập thủ công trên iPhone; nếu gặp màn đăng nhập, `ensureHome` báo lỗi thay vì nhập credential. Preview mask secret. Safe-stop là action cuối bắt buộc; không tự bấm booking/payment.
