# Vinpearl iPhone Automation Manager

Ứng dụng Electron chạy trên macOS để quản lý nhiều iPhone đã pair qua USB và điều khiển chúng bằng Appium 2/XCUITest. Appium chỉ chạy trên `127.0.0.1`; mỗi iPhone có UDID, WDA port và session riêng nên nhiều thiết bị có thể chạy song song.

## Kiến trúc

```text
Electron macOS
  -> Appium 2 (127.0.0.1:4723)
  -> XCUITest / WebDriverAgent
  -> iPhone USB đã pair/trust
  -> VinClub
```

SQLite tách ba nguồn dữ liệu: `devices` (UDID/Appium), `accounts` (username + Keychain reference) và `campaigns` (workflow, variables, danh sách cặp device-account). Password chỉ được lưu trong macOS Keychain; không nằm trong device, campaign, workflow JSON, renderer hoặc SQLite.

## Chuẩn bị macOS

1. Cài Xcode, mở một lần và pair/trust iPhone bằng USB; bật Developer Mode nếu iOS yêu cầu.
2. Cài Node.js rồi chạy `npm install`.
3. Cài Appium 2 và driver XCUITest:

```bash
npm install -g appium
appium driver install xcuitest
appium --address 127.0.0.1 --port 4723
```

4. Build/sign WebDriverAgent theo provisioning profile của thiết bị. Appium phải tạo được session với UDID thật trước khi chạy Live.

## Chạy và kiểm tra

```bash
npm run dev
npm run check
npm run package:mac
```

`Preview` chỉ mô phỏng workflow. Live run chỉ khởi động từ một campaign `active`; campaign chọn device, account và variables riêng. `selectDate`/`selectGuests` vẫn bị khóa cho tới khi selector profile WDA của VinClub được xác nhận trên thiết bị thật.

## An toàn vận hành

- Không mở Appium/WDA ra LAN.
- Không dùng tọa độ màn hình làm selector chính.
- Job có timeout, cancel, per-device lock và cleanup session.
- Workflow luôn dừng ở safe-stop trước booking/payment.
- Database legacy được archive timestamped khi ứng dụng phát hiện schema cũ.
