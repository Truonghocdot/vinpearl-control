# Vinpearl iPhone Automation Manager

Ứng dụng desktop Windows để quản lý nhiều iPhone jailbreak qua SSH, kiểm tra kết nối và chạy workflow có kiểm soát. Repository hiện có skeleton Electron + React + TypeScript cho MVP Device Manager.

## Tài liệu

- [Kế hoạch triển khai nghiệp vụ](docs/01-ke-hoach-trien-khai.md)

## Chạy local

```bash
npm install
npm run dev
```

Build production và đóng gói Windows:

```bash
npm run build
npm run package:win
```

Database MVP được lưu local bằng SQLite WASM (`sql.js`) để không phụ thuộc Visual Studio C++ toolchain khi khởi tạo dự án.

## Định hướng kiến trúc

```text
Electron + React + TypeScript
        |
Application services: devices, workflows, jobs, logs
        |
SQLite (sql.js, dữ liệu cục bộ) --- SSH service --- Automation adapters
```

Các lớp SSH và automation phải độc lập với UI. SSH thành công chỉ xác nhận khả năng kết nối lệnh, không mặc định là điều khiển được giao diện iOS.

## Nguyên tắc ban đầu

- Chỉ quản lý các thiết bị được ủy quyền.
- Xác minh host key trước khi cho phép chạy lệnh.
- Không lưu private key trực tiếp trong SQLite.
- Mọi job có timeout, retry có giới hạn và log theo từng bước.
- Bắt đầu bằng MVP quản lý thiết bị và kiểm tra SSH, sau đó mới mở rộng automation UI.

