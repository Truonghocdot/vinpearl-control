# Kế hoạch triển khai macOS

## Mục tiêu

Mac chạy Electron cục bộ và điều khiển nhiều iPhone USB bằng Appium 2/XCUITest. Mỗi iPhone được nhận diện bằng UDID, có WDA port/session/lock riêng; Mac mặc định chạy hai job song song và không chạy hai job trên một thiết bị.

## Lộ trình

1. **Foundation:** đăng ký UDID, Appium localhost health check, nguồn dữ liệu devices/accounts/campaigns riêng biệt và Keychain credential.
2. **WDA spike:** pair/trust iPhone, signing WDA, tạo session, launch, find, tap, input, source và screenshot trên thiết bị test.
3. **VinClub profile:** xác minh accessibility id/label/name, cài macro ngày và số khách từ primitive WDA, không dùng tọa độ làm selector production.
4. **Live jobs:** per-device lock, giới hạn song song, cancel, timeout, redaction, screenshot lỗi và lịch sử `job_runs`/`job_steps`.
5. **Internal release:** DMG macOS nội bộ, runbook Xcode/Appium, kiểm tra trên Mac sạch đã có prerequisite.

## Điều kiện nghiệm thu

- Appium chỉ bind `127.0.0.1`; WDA không bị mở ra LAN.
- iPhone chỉ là `ready` sau health check tạo/đóng Appium session thành công.
- Password chỉ nằm ở macOS Keychain; không xuất hiện trong SQLite, renderer hoặc log.
- Một job luôn cleanup session; lỗi lưu log đã redaction và screenshot best-effort.
- Campaign dừng tại safe-stop trước booking/payment.
