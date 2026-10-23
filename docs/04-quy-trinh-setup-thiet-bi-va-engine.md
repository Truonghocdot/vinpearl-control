# Quy trình setup macOS, Appium và iPhone

## Kiến trúc

Electron chạy trực tiếp trên Mac. Appium 2 lắng nghe loopback và dùng XCUITest/WebDriverAgent để tạo một session cho từng UDID. Mac có thể chạy tối đa hai job đồng thời; mỗi iPhone chỉ có một job và một WDA local port.

## Setup một thiết bị

1. Cắm iPhone bằng USB, pair/trust trong Finder hoặc Xcode và bật Developer Mode nếu được yêu cầu.
2. Ghi UDID Apple từ `xcrun devicectl` (ví dụ `00008101-001D48683E88001E`) và bundle ID MyVinpearl vào Device Manager.
3. Cài Appium 2, `xcuitest` driver và kiểm tra `GET http://127.0.0.1:4723/status`.
4. Cấu hình provisioning/signing cho WebDriverAgent; thử tạo session trên đúng UDID. Export `VINPEARL_XCODE_ORG_ID` bằng Team ID đã ký WDA trước khi chạy Electron.
5. Trong ứng dụng bấm **Kiểm tra**. Chỉ thiết bị `ready` mới được Live run.
6. Tạo Account riêng với username và credential reference; password được lưu trong macOS Keychain. Sau đó tạo Campaign để chọn account, device và bộ input booking riêng; không đưa password vào campaign JSON.

## Capability và selector

Engine dùng accessibility id trước, sau đó iOS predicate theo `label`/`name`; macro ngày dùng XPath chỉ để scope ngày theo block tháng. Không dùng tọa độ màn hình làm selector production. `selectDate` và `selectGuests` đã dùng profile từ tree hiện tại; cần capture và xác minh lại khi MyVinpearl đổi giao diện.

## Campaign runtime

Mỗi campaign dùng một action sequence booking cố định và truyền input riêng vào Appium session với `udid`, `bundleId`, `wdaLocalPort`. HTTP Appium dùng keep-alive, WDA được tái sử dụng (`useNewWDA=false`) và tắt chờ idle/animation (`waitForIdleTimeout=0`, `animationCoolOffTimeout=0`) để giảm latency; cuộn dùng thao tác kéo W3C trong khung element thay cho `mobile: scroll` (4–8 giây/lần). Runner kiểm tra capability, timeout từng step, redaction log, chụp screenshot mỗi step khi chạy test (UI tree chỉ khi step lỗi), ghi `job_runs`/`job_steps`, rồi luôn đóng session. Nút Cancel dùng `AbortController` và đánh dấu job `cancelled`.

## Lỗi thường gặp

- Appium không ready: khởi động `appium --address 127.0.0.1 --port 4723`.
- Device unpaired/offline: mở khóa iPhone, trust lại Mac, kiểm tra USB và Xcode.
- WDA signing/provisioning lỗi: sửa Team/profile trong WDA rồi thử session lại.
- Port WDA trùng: đổi `wdaLocalPort` của thiết bị; database tự cấp dải 8100+ khi đăng ký.
- Thiếu capability: Live run bị khóa, dùng Preview và cập nhật selector profile trước.
