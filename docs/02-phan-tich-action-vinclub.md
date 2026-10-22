# Action VinClub và selector profile

Workflow mẫu mở VinClub, đăng nhập, tìm khách sạn, chọn ngày/số khách, kiểm tra giá phòng rồi dừng an toàn trước thao tác đặt phòng. Đây là definition có version và không chứa password.

## Quy tắc selector

1. Accessibility id.
2. iOS predicate theo `label` hoặc `name` chính xác.
3. Selector profile đã normalize sau khi kiểm tra accessibility tree.

Không dùng tọa độ touch làm selector production. Mỗi bản VinClub cần được spike lại nếu tree hoặc nội dung UI đổi.

## Capability hiện có

`launchApp`, `waitForText`, `tapText`, `inputText`, `assertText` và `screenshot` gọi primitive Appium/XCUITest. `selectDate` và `selectGuests` vẫn là macro bị capability gate chặn cho tới khi xác minh selector profile trên iPhone test.

## Safety

`password` chỉ được resolve từ Keychain trong main process khi live job bắt đầu. Preview mask secret. Safe-stop là action cuối bắt buộc; không tự bấm booking/payment.
