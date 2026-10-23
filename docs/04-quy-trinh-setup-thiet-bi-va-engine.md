# Quy trình setup macOS, Appium và iPhone

## Kiến trúc

Electron chạy trực tiếp trên Mac. Appium 2 lắng nghe loopback và dùng XCUITest/WebDriverAgent để tạo một session cho từng UDID. Mac có thể chạy tối đa hai job đồng thời; mỗi iPhone chỉ có một job và một WDA local port.

## Setup một thiết bị

1. Cắm iPhone bằng USB, pair/trust trong Finder hoặc Xcode và bật Developer Mode nếu được yêu cầu.
2. Ghi UDID Apple từ `xcrun devicectl` (ví dụ `00008101-001D48683E88001E`) và bundle ID MyVinpearl vào Device Manager.
3. Cài Appium 2, `xcuitest` driver và kiểm tra `GET http://127.0.0.1:4723/status`.
4. Cấu hình provisioning/signing cho WebDriverAgent; thử tạo session trên đúng UDID. Export `VINPEARL_XCODE_ORG_ID` bằng Team ID đã ký WDA trước khi chạy Electron.
5. Trong ứng dụng bấm **Kiểm tra**. Chỉ thiết bị `ready` mới được Live run.
6. Đăng nhập MyVinpearl thủ công trên iPhone bằng tài khoản sẽ chạy (engine không tự đăng nhập, ứng dụng không lưu tài khoản). Sau đó tạo Campaign để chọn iPhone và bộ input booking.

## Kết nối qua IP

Thiết bị có hai kiểu kết nối (`connection_type`):

- **USB** (mặc định): Appium tự build/khởi động WDA qua cáp và forward về `wdaLocalPort` trên Mac (8100, 8101, …; mỗi máy USB một port riêng).
- **IP**: Appium gắn vào WDA **đang chạy sẵn** trên iPhone tại `http://<ip_address>:<wdaLocalPort>` (`appium:webDriverAgentUrl`), không forward port hay MJPEG. Port ở đây là port WDA trên chính iPhone, mặc định 8100, nhiều máy IP có thể dùng chung; mỗi IP chỉ gán cho một thiết bị.

Ở mode IP, Appium chỉ gọi HTTP tới WDA: không gửi `bundleId` (bỏ bước driver kiểm tra app qua kết nối thiết bị), `noReset=true`, `skipLogCapture=true`; app được mở/khởi động lại qua WDA. Vì vậy Mac chạy ứng dụng chỉ cần thấy `http://<ip>:<port>` qua mạng, không cần cáp và không cần iPhone hiện trong Xcode.

Cáp chỉ cần để **khởi động WDA**: iOS chỉ cho máy đã pair/trust chạy XCTest (WDA là một XCTest runner). Setup:

1. Cắm cáp một lần để pair/trust, bật Developer Mode, rồi trong Xcode (Devices and Simulators) bật **Connect via network**. Từ đó Mac có thể chạy WDA qua Wi-Fi; nên đặt IP tĩnh/DHCP reservation cho iPhone.
2. Khởi động WebDriverAgent trên iPhone (ví dụ `xcodebuild test-without-building -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination id=<UDID>` hoặc Product › Test trong Xcode) và giữ tiến trình đó chạy. Appium không tự khởi động WDA qua IP. Nếu khởi động bằng cáp thì rút cáp thường làm WDA dừng theo, nên khởi động qua kết nối mạng.
3. Kiểm tra `curl http://<ip>:8100/status` từ Mac, sau đó thêm thiết bị với kiểu kết nối **IP** và bấm **Kiểm tra**. Nếu WDA không phản hồi, ứng dụng báo lỗi ngay mà không tạo session. iPhone khởi động lại hoặc WDA crash thì phải chạy lại bước 2.

Máy IP luôn dùng URL của chính nó; `VINPEARL_WDA_URL` (nếu đặt) chỉ áp cho máy USB.

## Chạy nhiều iPhone

- Mỗi iPhone cần làm đủ các bước trên: pair/trust, Developer Mode, tin cậy certificate WDA, đăng nhập MyVinpearl bằng tài khoản riêng, rồi bấm **Kiểm tra** trong ứng dụng. Mỗi máy có WDA port riêng (8100, 8101, …) và MJPEG port = WDA port + 1000.
- Một campaign chọn nhiều iPhone thì các máy chạy cùng lúc với cùng bộ input; tối đa `VINPEARL_MAX_PARALLEL` job (mặc định 4), các máy còn lại chờ lượt. Session WDA được khởi động lần lượt từng máy (tránh tranh chấp DerivedData của Xcode); sau đó các lần chạy trên session ấm chạy song song.
- Không đặt `VINPEARL_WDA_URL` khi chạy nhiều máy: biến này trỏ mọi session vào một WDA duy nhất.
- Selector và bố cục lịch được đo trên iPhone 12 mini. Máy màn hình khác có thể cần một cú kéo chỉnh thêm ở bước chọn ngày (engine tự sửa theo khung ô ngày thật); nên chạy **Chạy test** trên từng mẫu máy trước khi dùng thật.

## Capability và selector

Engine dùng accessibility id trước, sau đó iOS predicate theo `label`/`name`; macro ngày dùng XPath chỉ để scope ngày theo block tháng. Không dùng tọa độ màn hình làm selector production. `selectDate` và `selectGuests` đã dùng profile từ tree hiện tại; cần capture và xác minh lại khi MyVinpearl đổi giao diện.

## Campaign runtime

Mỗi campaign dùng một action sequence booking cố định và truyền input riêng vào Appium session với `udid`, `bundleId`, `wdaLocalPort`. HTTP Appium dùng keep-alive, WDA được tái sử dụng (`useNewWDA=false`) và tắt chờ idle/animation (`waitForIdleTimeout=0`, `animationCoolOffTimeout=0`) để giảm latency; cuộn dùng thao tác kéo W3C trong khung element thay cho `mobile: scroll` (4–8 giây/lần). Runner kiểm tra capability, timeout từng step, redaction log, chụp screenshot ở các mốc `capture` khi chạy test (ngày, thanh toán, phòng, tổng kết, khách, modal cuối; step lỗi luôn có screenshot và UI tree), ghi `job_runs`/`job_steps`, và giữ session ấm cho lần chạy sau (hủy khi cancel). Nút Cancel dùng `AbortController` và đánh dấu job `cancelled`.

## Lỗi thường gặp

- Appium không ready: khởi động `appium --address 127.0.0.1 --port 4723`.
- Device unpaired/offline: mở khóa iPhone, trust lại Mac, kiểm tra USB và Xcode.
- WDA signing/provisioning lỗi: sửa Team/profile trong WDA rồi thử session lại.
- Port WDA trùng: đổi `wdaLocalPort` của thiết bị USB; database tự cấp dải 8100+ khi đăng ký (máy IP không chiếm port của Mac).
- Máy IP báo không kết nối được WDA: WDA đã dừng trên iPhone, iPhone đổi IP hoặc Mac khác mạng; khởi động lại WDA và sửa IP trong Device Manager.
- Thiếu capability: Live run bị khóa, dùng Preview và cập nhật selector profile trước.
