# Action VinClub và selector profile

Engine booking cố định mở VinClub, đăng nhập, tìm khách sạn, chọn ngày/số khách, kiểm tra giá phòng rồi dừng an toàn trước thao tác đặt phòng. Campaign chỉ cung cấp input, không chứa password.

## Quy tắc selector

1. Accessibility id.
2. iOS predicate theo `label` hoặc `name` chính xác.
3. Selector profile đã normalize sau khi kiểm tra accessibility tree.

Không dùng tọa độ touch làm selector production. Mỗi bản VinClub cần được spike lại nếu tree hoặc nội dung UI đổi.

## Capability hiện có

`launchApp`, `waitForText`, `tapText`, `inputText`, `assertText` và `screenshot` gọi primitive Appium/XCUITest. `tapText` chờ element xuất hiện (mặc định 10 giây hoặc `timeoutMs` của step) rồi mới chạm. Runner cho mỗi step thêm 5 giây so với `timeoutMs` để lỗi selector cụ thể được báo trước khi hết thời gian của step. `selectDate` và `selectGuests` dùng macro selector profile từ cây WDA đã capture: counter theo cấu trúc cell số khách, lịch cuộn theo tiêu đề tháng rồi chọn ngày trong đúng block tháng.

## Safety

`password` chỉ được resolve từ Keychain trong main process khi live job bắt đầu. Preview mask secret. Safe-stop là action cuối bắt buộc; không tự bấm booking/payment.
