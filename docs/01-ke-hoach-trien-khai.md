# Kế hoạch triển khai nghiệp vụ

## 1. Mục tiêu sản phẩm

Xây dựng một ứng dụng desktop Windows giúp operator:

1. Khai báo và quản lý nhiều iPhone jailbreak trong một nơi.
2. Xác minh thiết bị qua SSH một cách an toàn, có thể truy vết.
3. Định nghĩa các workflow theo từng bước, chạy thủ công hoặc theo lịch.
4. Theo dõi trạng thái, log, lỗi và lịch sử chạy của từng thiết bị.
5. Cho phép thay thế phương pháp automation iOS mà không phải viết lại giao diện quản lý.

### Ngoài phạm vi giai đoạn đầu

- Không coi SSH shell là giải pháp tự động hóa thao tác chạm, vuốt hoặc nhập liệu trong mọi ứng dụng iOS.
- Không đồng bộ dữ liệu lên cloud hoặc xây dựng multi-user server trong MVP.
- Không lưu private key trong SQLite.
- Không hỗ trợ thiết bị chưa được người dùng ủy quyền.

## 2. Quy trình nghiệp vụ đích

```text
Đăng ký thiết bị
  -> Xác minh host key và SSH
  -> Kiểm tra sức khỏe / đồng bộ trạng thái
  -> Tạo hoặc chọn workflow
  -> Chạy thử trên một thiết bị
  -> Chạy theo lịch hoặc theo nhóm thiết bị
  -> Theo dõi job, retry lỗi, xem log và lịch sử
```

### Vai trò tối thiểu

| Vai trò | Trách nhiệm |
| --- | --- |
| Admin vận hành | Cấu hình credential, phê duyệt host key, quản lý thiết bị và workflow |
| Operator | Chạy job, theo dõi trạng thái, xử lý lỗi kết nối |
| Kỹ thuật viên | Kiểm tra thiết bị, SSH, adapter và log khi có sự cố |

MVP có thể dùng một profile local duy nhất nhưng dữ liệu và quyền truy cập phải được thiết kế để không cản trở việc thêm phân quyền sau này.

## 3. Các phase triển khai

Thời lượng dưới đây là ước lượng cho một người phát triển toàn thời gian; cần điều chỉnh sau khi chốt thiết bị và automation adapter thực tế.

### Phase 0 — Khảo sát và chốt ranh giới

**Mục tiêu:** loại bỏ các giả định chưa kiểm chứng trước khi viết engine.

**Công việc chính:**

- Xác nhận phiên bản iOS, jailbreak, OpenSSH, NewTerm và mô hình rootless.
- Lập danh sách lệnh SSH được phép và lệnh có thể gây tác động nguy hiểm.
- Chọn cách lưu credential trên Windows (Credential Manager hoặc cơ chế bảo vệ tương đương).
- Xác định cách chọn host key, timeout, retry và quy tắc khi IP thay đổi.
- Thử nghiệm độc lập khả năng automation UI cần dùng; ghi rõ công cụ/agent bắt buộc.

**Đầu ra:** tài liệu compatibility matrix, danh sách lệnh được phép, quyết định credential và tiêu chí MVP.

**Điều kiện hoàn thành:** có ít nhất một thiết bị thật đại diện và một kịch bản kết nối thành công/thất bại được ghi nhận.

### Phase 1 — Nền tảng ứng dụng và quản lý thiết bị (MVP)

**Mục tiêu:** operator có thể thêm, sửa, vô hiệu hóa và kiểm tra một thiết bị từ desktop.

**Công việc chính:**

- Khởi tạo Electron, React, TypeScript và cấu trúc main/renderer/preload.
- Tạo SQLite schema cho `devices`, migration và backup local tối thiểu.
- Màn hình danh sách thiết bị, form thêm thiết bị và trạng thái kết nối.
- Kiểm tra dữ liệu đầu vào: địa chỉ, port, username, tên hiển thị.
- Hiển thị lần kiểm tra cuối, lỗi gần nhất và thời gian phản hồi.

**Đầu ra:** bản MVP cài chạy được trên Windows dev machine.

**Điều kiện hoàn thành:** thêm được thiết bị, đóng/mở app không mất dữ liệu, thiết bị sai cấu hình cho lỗi rõ ràng.

### Phase 2 — SSH service và an toàn credential

**Mục tiêu:** chuẩn hóa kết nối SSH để mọi chức năng phía trên dùng chung.

**Công việc chính:**

- Xây `SSH service` với connect, execute, timeout, disconnect và trạng thái chuẩn hóa.
- Xác minh host key/fingerprint lần đầu; cảnh báo và chặn khi fingerprint thay đổi.
- Lưu private key/secret ngoài SQLite; SQLite chỉ giữ reference và metadata cần thiết.
- Giới hạn lệnh, kích thước output và thời gian chạy; không treo UI khi thiết bị mất mạng.
- Ghi log audit cho kết nối, lệnh, kết quả và lỗi đã được phép ghi.

**Đầu ra:** service có test cho kết nối thành công, timeout, auth fail, host key mismatch và reconnect.

**Điều kiện hoàn thành:** mọi lệnh từ UI đều đi qua service này; không còn gọi `ssh.exe` rải rác trong renderer.

### Phase 3 — Workflow engine

**Mục tiêu:** chạy được workflow tuần tự trên một thiết bị với khả năng quan sát và khôi phục cơ bản.

**Công việc chính:**

- Định nghĩa schema workflow versioned và validate bằng Zod.
- Các step MVP: SSH command, delay, điều kiện kiểm tra output và ghi log.
- Tạo `job_runs`, `job_steps`, trạng thái pending/running/succeeded/failed/cancelled.
- Timeout theo step, retry có giới hạn, backoff và cơ chế hủy job.
- Chạy thử workflow trên một thiết bị trước khi cho phép chạy hàng loạt.

**Đầu ra:** workflow mẫu có thể lưu, sửa, chạy lại và xem lịch sử từng step.

**Điều kiện hoàn thành:** job lỗi ở giữa không làm mất lịch sử; retry không tạo chạy trùng ngoài ý muốn.

### Phase 4 — Automation adapter iOS

**Mục tiêu:** tích hợp phương pháp điều khiển iOS đã được xác minh ở Phase 0.

**Công việc chính:**

- Giữ interface engine độc lập với UI và workflow scheduler.
- Implement `SSHCommandEngine` trước cho các tác vụ hệ thống đã cho phép.
- Chỉ thêm `ScriptEngine` hoặc `UIAutomationEngine` khi có agent/công cụ chạy thật trên thiết bị.
- Chuẩn hóa capability của từng adapter để workflow biết step nào được hỗ trợ.
- Thử nghiệm trên ứng dụng đích, bao gồm timeout, app không ở trạng thái mong muốn và thiết bị mất kết nối.

**Đầu ra:** adapter có capability matrix và test trên thiết bị thật.

**Điều kiện hoàn thành:** UI không hiển thị tính năng mà adapter hiện tại không hỗ trợ; kết quả job phân biệt rõ command success và UI action success.

### Phase 5 — Scheduler và multi-device

**Mục tiêu:** chạy job theo lịch trên nhiều thiết bị mà vẫn kiểm soát được tải và lỗi.

**Công việc chính:**

- Lưu `schedules` với timezone, bật/tắt và version workflow.
- Tạo queue có concurrency limit, per-device lock và chống chạy chồng.
- Xử lý thiết bị offline, retry theo chính sách và dead-letter/error state.
- Cho phép nhóm thiết bị, chạy thủ công một nhóm và xem tiến độ tổng hợp.
- Bổ sung cơ chế recovery sau khi app bị đóng hoặc máy khởi động lại.

**Đầu ra:** lịch chạy định kỳ và màn hình job history theo thiết bị/workflow.

**Điều kiện hoàn thành:** không có hai job cùng tác động một thiết bị nếu policy không cho phép; job còn dang dở có trạng thái rõ sau restart.

### Phase 6 — Đóng gói và vận hành Windows

**Mục tiêu:** phát hành bản cài `.exe` có thể cài lại và chẩn đoán được lỗi.

**Công việc chính:**

- Cấu hình `electron-builder` và installer NSIS.
- Rebuild native module SQLite đúng Electron version.
- Kiểm thử trên máy Windows sạch, không phụ thuộc Node.js cài sẵn.
- Thiết lập versioning, migration khi nâng cấp và backup/restore SQLite.
- Tạo chế độ export log và gói thông tin chẩn đoán không chứa secret.

**Đầu ra:** installer, checklist release và hướng dẫn vận hành ngắn.

**Điều kiện hoàn thành:** cài mới, nâng cấp, gỡ/cài lại và khôi phục dữ liệu đều có kịch bản kiểm thử.

## 4. Phạm vi MVP đề xuất

MVP chỉ gồm Phase 1 và phần cốt lõi của Phase 2:

- Danh sách và form quản lý thiết bị.
- Lưu SQLite local.
- Credential reference, host fingerprint và xác minh SSH.
- Nút kiểm tra kết nối, timeout và log kết quả.
- Không gồm workflow editor, scheduler hay UI automation.

MVP được xem là đạt khi operator có thể thêm một iPhone thật, xác minh đúng host key, kiểm tra SSH thành công/thất bại và đọc được lý do lỗi mà không cần mở terminal.

## 5. Backlog theo mức ưu tiên

| Mức | Hạng mục |
| --- | --- |
| P0 | Compatibility matrix, host key verification, credential protection, device CRUD, SSH health check |
| P1 | Workflow schema, command step, job history, timeout/retry, log viewer |
| P2 | Scheduler, queue, concurrency limit, nhóm thiết bị, recovery |
| P3 | UI automation adapter, template workflow, export/reporting, auto-update |

## 6. Tiêu chí chất lượng chung

- Không thực thi job nếu thiết bị chưa được xác minh host key.
- Không để secret xuất hiện trong SQLite, UI log hoặc file diagnostic export.
- Mọi thao tác có thể thay đổi thiết bị phải có timeout, kết quả và lịch sử.
- Renderer không được tự mở socket hoặc đọc private key; các quyền này nằm ở main/service layer.
- Có test cho các lỗi kết nối và restart trước khi mở rộng concurrency.

## 7. Rủi ro và quyết định cần chốt

| Rủi ro / quyết định | Tác động | Cách xử lý trước khi vào phase liên quan |
| --- | --- | --- |
| SSH không điều khiển được UI iOS | Workflow không đáp ứng mục tiêu nghiệp vụ | Spike adapter ở Phase 0, không hứa tính năng UI trước khi có bằng chứng |
| IP thiết bị thay đổi | Không kết nối được hoặc nhầm thiết bị | Lưu fingerprint, cho phép cập nhật endpoint có xác nhận |
| Native SQLite lệch Electron version | App đóng gói không chạy | Pin version và chạy rebuild trong CI/release |
| Thiết bị offline giữa workflow | Job treo hoặc trạng thái sai | Timeout, retry bounded, trạng thái interrupted/recoverable |
| Chạy đồng thời gây tác động ngoài ý muốn | Mất kiểm soát thiết bị | Per-device lock và concurrency limit mặc định bằng 1 |
| Credential bị lộ qua log/backup | Rủi ro bảo mật | Secret store của Windows, redaction và test log |

## 8. Cổng nghiệm thu theo release

### Release R0 — Kế hoạch và spike

- Có compatibility matrix và một thiết bị test.
- Chốt credential store, host key policy và danh sách lệnh được phép.

### Release R1 — Device Manager MVP

- Cài chạy được trên Windows dev machine.
- CRUD thiết bị, SQLite migration, SSH health check và log lỗi.

### Release R2 — Workflow beta

- Workflow versioned, job history, step timeout/retry và cancel.
- Không chạy chồng trên cùng một thiết bị.

### Release R3 — Multi-device beta

- Scheduler, queue, recovery sau restart và installer test trên máy sạch.

### Release R4 — Automation production candidate

- Adapter iOS được kiểm thử trên thiết bị/app đích.
- Có runbook vận hành, backup/restore và checklist phát hành.

## 9. Việc nên làm ngay sau khi khởi tạo repo

1. Chốt một thiết bị test và điền compatibility matrix.
2. Chốt policy host key và nơi lưu private key trên Windows.
3. Tạo skeleton Electron tối thiểu sau khi các quyết định trên được ghi nhận.
4. Implement Device Manager MVP, chưa mở workflow editor.

