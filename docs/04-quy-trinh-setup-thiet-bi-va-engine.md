# Quy trình setup iPhone và lộ trình engine

## 1. Quyết định kiến trúc

Ứng dụng Windows sẽ giữ vai trò quản lý thiết bị, queue, workflow và log. SSH là lớp transport để probe thiết bị, chạy lệnh hệ thống và tạo tunnel. UI automation phải đi qua một engine riêng có capability rõ ràng.

```text
Electron Windows
  -> SSH service: host key, exec, timeout, tunnel
  -> iPhone agent: health, capabilities, session, action, screenshot
  -> UI automation provider: WDA/Appium hoặc agent jailbreak riêng
  -> VinClub
```

`OpenSSH`, `NewTerm` và shell trên iPhone không tự cung cấp tap, swipe, nhập liệu hoặc accessibility tree. `NewTerm` chỉ là terminal để kiểm tra thủ công.

## 2. Compatibility gate phải chốt trước

Ghi lại cho từng thiết bị:

| Trường | Ví dụ | Vì sao cần |
| --- | --- | --- |
| Model/chip | iPhone X / A11 | Xác định giới hạn jailbreak và engine |
| iOS build | 16.x | Chọn phiên bản Xcode/WDA hoặc agent |
| Jailbreak | palera1n rootless | Xác định package/bootstrap và đường dẫn |
| Package manager | Sileo/Zebra | Cài OpenSSH và dependency |
| SSH server | dropbear hoặc OpenSSH | Port và capability khác nhau |
| UI provider | WDA/Appium/custom agent | Quyết định host và cách triển khai |

palera1n chính thức hỗ trợ nhóm thiết bị A8–A11/T2 trên iOS/iPadOS/tvOS 15 trở lên; A11 có yêu cầu riêng về passcode/reset. Việc jailbreak và việc UI automation là hai compatibility gate độc lập. Xem [README palera1n](https://github.com/palera1n/palera1n/blob/main/README.md).

### Gate WDA/Appium

WDA dùng XCTest để điều khiển app iOS. Tài liệu Appium yêu cầu real device được pair/trust, bật Developer Mode và UI Automation, cài `WebDriverAgentRunner` có provisioning profile. XCUITest driver ưu tiên macOS + Xcode + Appium; Windows/Linux chỉ có hỗ trợ giới hạn theo từng phiên bản. Xem [device setup](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/device-setup/), [system requirements](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/system-requirements/) và [non-macOS hosts](https://appium.github.io/appium-xcuitest-driver/latest/guides/non-macos-hosts/).

Vì vậy, nếu thiết bị là palera1n A8–A11 trên iOS 15/16, chưa được phép kết luận WDA/Appium chạy được chỉ vì máy đã jailbreak. Phải spike một thiết bị thật bằng Mac/Xcode trước. Nếu cần giữ Windows-only và iOS cũ, phải kiểm chứng custom jailbreak UI agent riêng.

## 3. Quy trình setup một thiết bị

### Bước 0 — Chuẩn bị và inventory

1. Dùng cáp/host được palera1n hỗ trợ để boot jailbreak; sau reboot phải kiểm tra lại trạng thái jailbreak.
2. Mở Sileo/Zebra, ghi phiên bản bootstrap/package manager.
3. Ghi model, iOS build, UDID và tên thiết bị vào compatibility matrix.
4. Đặt iPhone và máy Windows trong mạng LAN ổn định; dùng DHCP reservation hoặc hostname nếu IP thay đổi.
5. Không đưa tài khoản VinClub thật vào bước spike đầu tiên; dùng tài khoản test và dừng trước booking/payment.

### Bước 1 — Cài lớp SSH

Trên package manager, cài **một** SSH server được bootstrap hỗ trợ:

- `dropbear` có thể được palera1n cung cấp cho shell bootstrap, thường cần kiểm tra port 44.
- `OpenSSH` phù hợp hơn cho service lâu dài, key authentication, host key và tunnel; port thường là 22 nhưng phải probe thực tế.

Không giả định mọi thiết bị đều dùng port 22. App nên thử port đã cấu hình, sau đó probe port 44/22 theo policy có kiểm soát.

Kiểm tra read-only từ Windows:

```powershell
ssh -p <port> <user>@<ip> "uname -a; id; echo \$PATH; command -v sshd; command -v dropbear; test -d /var/jb && echo rootless"
```

Kết quả cần lưu trong device probe:

- SSH server và version.
- User đang đăng nhập.
- `PATH` thực tế.
- Có `/var/jb` hay không.
- Port đang lắng nghe.
- Dung lượng trống và thời gian phản hồi.

Rootless không nên bị hard-code thành một path duy nhất. Agent phải resolve executable bằng `PATH`, kiểm tra `/var/jb` và ghi lại path đã chọn.

### Bước 2 — Chuyển sang SSH key

Trên Windows tạo key riêng cho ứng dụng:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\vinpearl_iphone_ed25519"
```

Đưa public key vào `authorized_keys` của đúng SSH user theo hướng dẫn của package SSH đang dùng. Kiểm tra quyền file theo user/home thực tế; không ghi đè file cấu hình chưa đọc.

Trong ứng dụng:

1. Private key đi vào Windows Credential Manager/Electron `safeStorage` hoặc secret store tương đương.
2. SQLite chỉ lưu `credentialRef`, không lưu private key/password.
3. Lần kết nối đầu tiên hiển thị fingerprint để operator phê duyệt.
4. Fingerprint đổi thì chặn kết nối và yêu cầu phê duyệt lại.

### Bước 3 — Probe và đăng ký thiết bị

Device Setup Wizard cần có các bước:

```text
Nhập host/port/user
  -> connect SSH
  -> hiển thị fingerprint
  -> probe readonly
  -> lưu model/iOS/jailbreak/SSH server
  -> health check
  -> chọn engine khả dụng
```

Các IPC cần bổ sung:

- `devices:probe`
- `devices:trust-host`
- `devices:test-ssh`
- `devices:capabilities`
- `devices:start-agent`
- `devices:stop-agent`

### Bước 4 — Cài và kiểm tra agent

Agent không phải model AI; đó là chương trình chạy trên iPhone. Bản đầu nên là daemon/service nhỏ, bind `127.0.0.1`, nhận JSON và trả JSON.

Protocol tối thiểu:

```text
GET  /health
GET  /capabilities
POST /session/start
POST /action
GET  /screenshot
POST /session/stop
```

Một `capabilities` response nên cho biết:

```json
{
  "engine": "custom-ios-agent",
  "version": "0.1.0",
  "actions": ["launchApp", "tapText", "inputText", "screenshot"],
  "bundleIds": ["com.example.vinclub"]
}
```

Desktop không mở port agent ra LAN. Desktop tạo SSH local port-forward trong thời gian job, kiểm tra `/health`, rồi đóng tunnel khi job kết thúc. Agent phải có timeout, request id, log redaction và cơ chế stop.

Việc chạy lâu dài qua `launchd` chỉ thực hiện sau khi foreground start/health/action đã ổn. Sau reboot hoặc khi jailbreak chưa được kích hoạt, agent có thể không tồn tại; health check phải trả trạng thái `jailbreak-inactive` thay vì tự retry vô hạn. Apple mô tả `launchd` job bằng plist có `Label`, `ProgramArguments`, socket/dependency và `KeepAlive`; xem [Creating Launchd Jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html). Đường dẫn rootless cụ thể phải được kiểm chứng trên bootstrap thực tế.

## 4. Các engine và lựa chọn

| Engine | Làm được | Yêu cầu | Quyết định |
| --- | --- | --- | --- |
| `SSHCommandEngine` | Probe, process, file, service, log | OpenSSH/dropbear | Làm trước ngay |
| `WdaAutomationEngine` | Launch app, accessibility, tap, input, screenshot | WDA build/sign, pair/trust, Developer Mode/UI Automation, host Mac/Xcode hoặc remote setup tương thích | Spike trên một máy |
| `CustomIosAgentEngine` | Primitive UI theo app/version do mình kiểm soát | Agent jailbreak/native code và cơ chế đọc UI/touch đã được chứng minh | Nhánh Windows-only nếu WDA không phù hợp |
| Screenshot/touch injection | Tọa độ và thao tác màn hình | Tool jailbreak cụ thể | Chỉ dùng prototype, không production |

`libimobiledevice` có thể hỗ trợ discovery, pairing, diagnostics, screenshot và service transport cross-platform, nhưng không phải UI automation engine. Xem [libimobiledevice](https://github.com/libimobiledevice/libimobiledevice).

## 5. Lộ trình phát triển tiếp theo

### Phase A — SSH thật

- `ssh2` service và `SSHCommandEngine` đã được thêm trong `src/main/ssh/`.
- Engine hiện đã implement connect/exec/timeout/output cap/host fingerprint.
- Hỗ trợ port 44/22 theo cấu hình.
- Pin host key.
- Thêm device probe và health check.
- Bổ sung schema: `udid`, `ios_version`, `jailbreak_type`, `rootless`, `ssh_server`, `credential_ref`, `last_error`, `engine`, `agent_port`.

API IPC hiện có:

```typescript
window.desktopApi.probeSsh({
  target: { host, port, username, hostFingerprint },
  auth: { privateKey, passphrase /* hoặc password tạm thời */ },
});

window.desktopApi.runSshCommand({
  target: { host, port, username, hostFingerprint },
  auth: { privateKey, passphrase },
  command: 'uname -a',
});
```

Lần probe đầu tiên không tự chấp nhận host key. IPC trả về:

```json
{ "status": "host-untrusted", "fingerprint": "SHA256:..." }
```

Sau khi operator phê duyệt fingerprint, gọi lại với `target.hostFingerprint`. Kết quả thành công có `stdout`, `stderr`, `code`, `durationMs` và fingerprint đã xác minh.

Private key/password chỉ được truyền transient qua IPC trong module hiện tại, chưa được lưu vào SQLite. Setup wizard tiếp theo phải lấy key từ Windows Credential Manager/Electron `safeStorage`.

### Phase B — Setup wizard và capability

- UI checklist setup thiết bị.
- Hiển thị bước nào pass/fail và lệnh probe nào đã chạy.
- `agent:start`, `agent:health`, `agent:stop`.
- Không cho chạy action nếu capability không có.
- Per-device lock; một thiết bị chỉ có một session automation.

### Phase C — Spike UI engine

1. Chọn một iPhone thật, một iOS build và một Mac có Xcode.
2. Pair/trust thiết bị, bật Developer Mode và UI Automation.
3. Build/install WDA, chạy các primitive: launch, source, find text, tap, input, screenshot.
4. Chạy đúng workflow VinClub, dừng trước `Đặt phòng`.
5. Ghi compatibility matrix và quyết định WDA hoặc custom agent.

### Phase D — Gắn engine vào workflow

Đổi runner từ preview-only sang dependency injection:

```typescript
runWorkflow(workflow, engine, device)
```

Runner phải kiểm tra capability trước mỗi step. `selectDate` và `selectGuests` là macro app-specific gồm nhiều primitive UI, không phải một lệnh SSH đơn lẻ.

### Phase E — Multi-device

- Queue có concurrency limit.
- Lock theo device.
- Mỗi location gắn với device/session cụ thể.
- Reset app/session giữa các location.
- Lưu screenshot, engine version, device state và error code theo từng step.

## 6. Definition of done cho một thiết bị

Thiết bị chỉ được đánh dấu `ready` khi:

- SSH key login thành công.
- Host fingerprint đã được phê duyệt.
- Probe đọc được iOS/model/jailbreak/SSH server.
- Agent health trả lời trong timeout.
- Capability có đủ primitive workflow cần dùng.
- Chạy được test `launch -> find -> tap -> input -> screenshot` trên tài khoản test.
- Workflow dừng đúng safe stop trước booking/payment.

## 7. Nguồn kỹ thuật chính

- [palera1n README](https://github.com/palera1n/palera1n/blob/main/README.md)
- [palera.in](https://palera.in/)
- [WebDriverAgent](https://github.com/appium/WebDriverAgent)
- [Appium XCUITest device setup](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/device-setup/)
- [Appium XCUITest system requirements](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/system-requirements/)
- [Appium non-macOS hosts](https://appium.github.io/appium-xcuitest-driver/latest/guides/non-macos-hosts/)
- [Appium RemoteXPC tunnels](https://appium.github.io/appium-xcuitest-driver/latest/guides/remotexpc-tunnels-real-devices/)
- [appium-ios-device](https://github.com/appium/appium-ios-device)
- [libimobiledevice](https://github.com/libimobiledevice/libimobiledevice)

