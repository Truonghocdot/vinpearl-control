# Vinpearl iPhone Automation Manager

Ứng dụng Electron chạy trên macOS để quản lý nhiều iPhone đã pair với Mac (kết nối USB hoặc IP) và điều khiển chúng bằng Appium 2/XCUITest. Appium chỉ chạy trên `127.0.0.1`; mỗi iPhone có UDID, WDA port và session riêng nên nhiều thiết bị có thể chạy song song.

## Kiến trúc

```text
Electron macOS
  -> Appium 2 (127.0.0.1:4723)
  -> XCUITest / WebDriverAgent
  -> iPhone đã pair/trust (USB, hoặc IP: WDA chạy sẵn trên iPhone)
     (iOS 16 trở xuống: WDA do go-ios chạy, xem docs/04)
  -> VinClub
```

SQLite có hai nguồn dữ liệu: `devices` (UDID, kiểu kết nối `usb`/`ip`, IP, WDA port) và `campaigns` (bộ input booking + danh sách iPhone chạy). Ứng dụng không quản lý tài khoản hay mật khẩu: mỗi iPhone chạy bằng tài khoản MyVinpearl đang đăng nhập thủ công trên máy đó. Database cũ có bảng `accounts` được tự migrate khi mở ứng dụng (giữ campaign và lịch sử chạy, bỏ bảng tài khoản).

## Chuẩn bị macOS

1. Cài Xcode, mở một lần và pair/trust iPhone bằng USB; bật Developer Mode nếu iOS yêu cầu.
2. Cài Node.js rồi chạy `npm install` (tự tải go-ios 1.3.2 vào `vendor/go-ios/ios`, đã kiểm tra checksum).
3. Cài Appium 2 và driver XCUITest:

```bash
npm install -g appium
appium driver install xcuitest
appium --address 127.0.0.1 --port 4723
```

4. Build/sign WebDriverAgent theo provisioning profile của thiết bị. Appium phải tạo được session với UDID thật trước khi chạy Live. iPhone iOS 16 trở xuống (ví dụ iPhone 7) không chạy được WDA qua Xcode 26.4+: bấm **Chuẩn bị WDA** trên dòng thiết bị để ứng dụng build, vá và cài WDA rồi chạy nó bằng go-ios ([docs/04](docs/04-quy-trinh-setup-thiet-bi-va-engine.md#wda-cho-ios-16-trở-xuống-go-ios)).

Đặt Team ID để Appium tự ký/chạy WDA:

```bash
export VINPEARL_XCODE_ORG_ID="7UQ9N92G6X"
export VINPEARL_XCODE_SIGNING_ID="Apple Development"
npm run dev
```

Mặc định WDA không chờ app idle/animation (`VINPEARL_WDA_IDLE_TIMEOUT=0`, `VINPEARL_WDA_ANIMATION_COOLOFF=0`): đo trên iPhone 12 mini, chờ idle làm mỗi tap chậm thêm ~0,7 giây và mỗi lần cuộn thêm ~2 giây mà màn sau không hiện sớm hơn. Workflow tự chờ element trước khi chạm, và các tap dễ rơi vào lúc chuyển cảnh dùng `until` để xác minh và chạm lại. Có thể đặt lại `VINPEARL_WDA_IDLE_TIMEOUT=1` nếu một bản MyVinpearl mới bỏ lỡ tap. `VINPEARL_MAX_TYPING_FREQUENCY` mặc định `60`.

## Chạy và kiểm tra

```bash
npm run dev
npm run check
npm run package:mac
```

Campaign là đơn vị cấu hình duy nhất của sản phẩm: action booking được engine giữ cố định, còn mỗi campaign chọn các iPhone và bộ input riêng. `selectDate`/`selectGuests` dùng selector profile từ accessibility tree đã thu thập; sau mỗi bản cập nhật MyVinpearl cần capture UI tree và xác minh lại profile trước khi chạy.

Kịch bản Hà Tĩnh được trích từ video và dừng trước xác nhận giao dịch được mô tả tại [docs/05-kich-ban-tu-video-ha-tinh.md](docs/05-kich-ban-tu-video-ha-tinh.md).
Schema input campaign và ví dụ `paymentYear`/`roomType` nằm tại [docs/06-schema-campaign.md](docs/06-schema-campaign.md).

## An toàn vận hành

- Không mở Appium/WDA ra LAN.
- Không dùng tọa độ màn hình làm selector chính.
- Job có timeout, cancel và per-device lock. Session Appium được giữ ấm theo thiết bị (tạo khi Kiểm tra hoặc lần chạy đầu, mỗi lần chạy chỉ khởi động lại MyVinpearl; Appium thu hồi sau 30 phút không dùng; đóng khi thoát ứng dụng).
- Engine không đăng nhập MyVinpearl: iPhone phải được đăng nhập thủ công trước; nếu app đang ở màn đăng nhập, job dừng với lỗi rõ ràng.
- Engine booking luôn dừng ở safe-stop trước booking/payment.
- Database legacy được archive timestamped khi ứng dụng phát hiện schema cũ.
