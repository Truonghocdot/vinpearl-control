# Hướng dẫn lệnh trên macOS, Linux và Windows

Tài liệu này gom mọi lệnh cần để chạy dự án và để đưa WebDriverAgent (WDA) lên iPhone, theo từng hệ điều hành. Đọc mục 1 trước để biết cái gì chạy được ở đâu.

## 1. Tóm tắt nhanh

| Việc | macOS | Linux | Windows |
|---|---|---|---|
| Chạy ứng dụng (giao diện, campaign) | Có, đã dùng hằng ngày | Chưa hỗ trợ | Chưa hỗ trợ |
| Build WDA từ mã nguồn | Có (cần Xcode) | Không thể | Không thể |
| Ký WDA cho một iPhone | Có, đã thử | Chưa thử (cần `zsign`) | Chưa thử (cần `zsign`) |
| Cài và chạy WDA bằng go-ios | Đã thử: iPhone 7 iOS 15.8.8, iPhone 12 mini iOS 26.6.2 | Chưa thử | Chưa thử |
| Appium điều khiển iPhone qua WDA | Đã thử | Chưa thử | Chưa thử |

Hướng dùng được trên mọi hệ điều hành: **build và ký WDA trên Mac một lần, mang file đã ký sang máy Linux/Windows, rồi chỉ cài và chạy bằng go-ios** (mục 6). Các bước ở mục 6 và 7 được viết theo tài liệu của go-ios và Appium nhưng chưa được chạy thử trên Linux/Windows.

## 2. Khái niệm cần biết

- **WDA (WebDriverAgent):** app nhỏ chạy trên iPhone, mở một server HTTP (mặc định port 8100) để máy tính điều khiển màn hình. Appium nói chuyện với iPhone qua WDA.
- **go-ios:** công cụ dòng lệnh (lệnh `ios`) để cài app, chạy WDA, chuyển port, đọc log iPhone mà không cần Xcode. Dự án dùng bản 1.3.2.
- **Tunnel (chỉ iOS 17 trở lên):** từ iOS 17, máy tính phải mở một "đường hầm" tới iPhone trước khi chạy WDA. Lệnh: `ios tunnel start --userspace` (không cần quyền root/admin). iOS 16 trở xuống không cần.
- **Developer Disk Image (DDI):** bộ công cụ phát triển phải được gắn (mount) vào iPhone. Xcode thường gắn sẵn; trên Linux/Windows dùng `ios image auto`.
- **Ký app và provisioning profile:** iPhone chỉ chạy WDA đã ký bằng chứng chỉ Apple, kèm một profile có **UDID của chính máy đó**. Tài khoản Apple miễn phí: profile chỉ có hạn **7 ngày** và chỉ Xcode trên Mac mới thêm được máy mới vào profile.
- **Hai loại port:**
  - *Port trên iPhone:* WDA nghe ở đây, mặc định 8100. Mọi iPhone đều dùng 8100 được vì mỗi máy là một thiết bị riêng.
  - *Port trên Mac:* với máy cắm USB, port trên iPhone được chuyển về một port trên Mac. Mỗi iPhone cần một port Mac riêng (8100, 8101, …). Ứng dụng tự cấp nếu để trống.

## 3. macOS: chạy ứng dụng (cách dùng chính)

### 3.1. Cài đặt một lần

```bash
# 1. Xcode: cài từ App Store, mở một lần để cài thêm thành phần.
# 2. Node.js: cài bản LTS từ nodejs.org.

# 3. Lấy mã nguồn và cài thư viện (lệnh này tự tải go-ios vào vendor/go-ios/ios)
cd ~/Workspace/vinpearl-control
npm install

# 4. Appium và driver cho iOS
npm install -g appium
appium driver install xcuitest
```

5. **Đổi bundle ID của WDA** nếu dùng tài khoản Apple miễn phí (Apple không cho đăng ký `com.facebook.*`). Mở `~/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent/WebDriverAgent.xcodeproj` bằng Xcode, ở các target WebDriverAgentLib, WebDriverAgentRunner, IntegrationApp đổi bundle ID sang tên riêng (dự án đang dùng `net.nhmsoft.*`) và chọn Team của bạn. Cập nhật driver Appium sẽ ghi đè thay đổi này, khi đó phải đổi lại.
6. **Trên mỗi iPhone:** cắm cáp, bấm "Tin cậy", bật Developer Mode (iOS 16 trở lên: Cài đặt › Quyền riêng tư & Bảo mật › Chế độ nhà phát triển), đăng nhập MyVinpearl bằng tay.

### 3.2. Chạy hằng ngày

Mở hai cửa sổ Terminal:

```bash
# Terminal 1: Appium (để chạy suốt)
appium --address 127.0.0.1 --port 4723
```

```bash
# Terminal 2: ứng dụng
cd ~/Workspace/vinpearl-control
export VINPEARL_XCODE_ORG_ID="7UQ9N92G6X"   # Team ID dùng để ký WDA
npm run dev
```

Trong ứng dụng:

1. **Thêm thiết bị:** nhập tên và UDID, để trống ô port.
2. Bấm **Health**. Lần đầu, ứng dụng tự đọc phiên bản iOS:
   - iOS 16 trở xuống: tự build, ký và cài WDA (khoảng 35 giây), rồi chạy WDA bằng go-ios;
   - iOS 17 trở lên: để Appium tự chạy WDA qua Xcode.
3. Khi banner báo profile WDA sắp hết hạn, bấm **Chuẩn bị WDA** (hoặc Health khi còn dưới 1 ngày, ứng dụng tự ký lại).

`npm run dev` chỉ biên dịch phần main của Electron một lần lúc khởi động. **Sau khi `git pull` hoặc đổi nhánh, phải tắt (Ctrl+C) và chạy lại `npm run dev`**, nếu không ứng dụng vẫn chạy code cũ (ví dụ lỗi `no such column: account_id`).

### 3.3. Kiểm tra và đóng gói

```bash
npm run check        # typecheck, build và toàn bộ bài kiểm tra tự động
npm run package:mac  # tạo file .dmg (kèm go-ios) trong thư mục release/
```

### 3.4. Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `VINPEARL_XCODE_ORG_ID` | (trống) | Team ID Apple để ký WDA |
| `VINPEARL_XCODE_SIGNING_ID` | `Apple Development` | Tên chứng chỉ ký |
| `VINPEARL_APPIUM_PORT` | `4723` | Port của Appium |
| `VINPEARL_MAX_PARALLEL` | `4` | Số iPhone chạy song song tối đa |
| `VINPEARL_WDA_URL` | (trống) | Ép mọi máy USB dùng một WDA URL. Không đặt khi chạy nhiều máy |
| `VINPEARL_WDA_IDLE_TIMEOUT` | `0` | Thời gian WDA chờ app rảnh trước mỗi thao tác |
| `VINPEARL_WDA_ANIMATION_COOLOFF` | `0` | Thời gian WDA chờ hiệu ứng chuyển cảnh |
| `VINPEARL_MAX_TYPING_FREQUENCY` | `60` | Tốc độ gõ phím |
| `VINPEARL_GO_IOS_PATH` | `vendor/go-ios/ios` | Dùng một file go-ios khác |
| `VINPEARL_WDA_PROJECT` | project WDA của Appium | Thư mục WebDriverAgent dùng để build |
| `APPIUM_HOME` | `~/.appium` | Thư mục cài driver của Appium |

## 4. Lệnh go-ios (giống nhau trên cả ba hệ điều hành)

### 4.1. Gọi lệnh `ios`

Trên Mac, go-ios nằm trong dự án, **không có sẵn trong PATH** (gõ `ios` sẽ báo `command not found`). Chọn một cách:

```bash
# Gọi đường dẫn đầy đủ
~/Workspace/vinpearl-control/vendor/go-ios/ios list

# Hoặc thêm vào PATH một lần, sau đó gõ "ios" ở đâu cũng được
echo 'export PATH="$HOME/Workspace/vinpearl-control/vendor/go-ios:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Cài go-ios trên Linux/Windows: xem mục 5.2 và 5.3.

### 4.2. Các lệnh hay dùng

Thêm `--udid=<UDID>` khi có nhiều iPhone. Mọi lệnh trả kết quả dạng JSON; thêm `--pretty` cho dễ đọc.

| Lệnh | Dùng để |
|---|---|
| `ios version` | Xem phiên bản go-ios |
| `ios list --details` | Liệt kê iPhone đang kết nối, phiên bản iOS, USB hay mạng |
| `ios info --udid=<UDID>` | Xem chi tiết một máy (tên, iOS, model) |
| `ios pair --udid=<UDID>` | Ghép đôi máy tính với iPhone (iPhone hiện hộp thoại "Tin cậy") |
| `ios devmode get` / `ios devmode enable` | Xem / bật Developer Mode (iOS 16 trở lên) |
| `ios image list` | Xem DDI đã gắn chưa |
| `ios image auto` | Tự tải và gắn DDI (iOS 17+: chạy tunnel trước) |
| `ios tunnel start --userspace` | Mở tunnel cho iOS 17+. Chạy liên tục, để cửa sổ đó mở |
| `ios tunnel ls` | Xem tunnel đang chạy |
| `ios apps` | Liệt kê app đã cài |
| `ios install --path=<file .app hoặc .ipa>` | Cài app |
| `ios uninstall <bundleId>` | Gỡ app |
| `ios launch <bundleId>` / `ios kill <bundleId>` | Mở / tắt app |
| `ios runwda --bundleid=<id> --testrunnerbundleid=<id> --xctestconfig=WebDriverAgentRunner.xctest --env=USE_PORT=8100` | Chạy WDA. WDA sống tới khi lệnh này dừng |
| `ios forward <portMáyTính> <portiPhone>` | Chuyển port, ví dụ `ios forward 8101 8100` |
| `ios syslog` | Xem log của iPhone (tìm lỗi WDA không mở được) |
| `ios ps` | Liệt kê tiến trình đang chạy trên iPhone |
| `ios screenshot --output=man-hinh.png` | Chụp màn hình |

### 4.3. Chạy WDA bằng tay

Các bước này giống nhau trên mọi hệ điều hành. Thay `<UDID>` và `<BUNDLE>` bằng giá trị thật. `<BUNDLE>` là bundle ID của WDA đã ký, ví dụ `net.nhmsoft.WebDriverAgentRunner.xctrunner`.

**Cảnh báo:** không làm các bước này trên một iPhone mà ứng dụng đang điều khiển. Cài hoặc chạy WDA trùng bundle ID sẽ tắt WDA của Appium, và chế độ automation trên iPhone sẽ tự tắt.

```bash
# 1. Kiểm tra máy có hiện không
ios list --details

# 2. Chỉ với iOS 17+: mở tunnel ở một cửa sổ riêng và để chạy suốt
ios tunnel start --userspace

# 3. Cài WDA đã ký (bỏ qua nếu đã cài)
ios install --path=WebDriverAgentRunner-Runner.app --udid=<UDID>

# 4. Chạy WDA ở một cửa sổ riêng và để chạy suốt
ios runwda --bundleid=<BUNDLE> --testrunnerbundleid=<BUNDLE> --xctestconfig=WebDriverAgentRunner.xctest --env=USE_PORT=8100 --udid=<UDID>

# 5. Chuyển port 8100 trên iPhone về port 8101 trên máy tính (cửa sổ riêng)
ios forward 8101 8100 --udid=<UDID>

# 6. Thử WDA: thấy "ready" : true là được
curl http://127.0.0.1:8101/status
```

Nếu máy tính và iPhone cùng mạng Wi-Fi, có thể gọi thẳng `http://<IP của iPhone>:8100/status` (IP nằm trong kết quả `/status`, mục `ios.ip`). Trong thử nghiệm trên Mac, WDA sẵn sàng khoảng 4 giây sau bước 4.

## 5. Chuẩn bị máy Linux / Windows (chưa chạy thử)

### 5.1. Điều cần biết trước

- Ứng dụng Electron hiện chỉ đóng gói và chạy trên macOS. Trên Linux/Windows, bạn chạy WDA bằng go-ios và điều khiển bằng Appium (mục 7).
- Linux/Windows **không build được WDA** và với tài khoản Apple miễn phí **không thêm được iPhone mới vào profile**. Hai việc đó phải làm trên Mac (mục 6).

### 5.2. Linux (Ubuntu/Debian)

```bash
# Dịch vụ giao tiếp với iPhone qua USB
sudo apt update && sudo apt install -y usbmuxd curl nodejs npm

# go-ios 1.3.2: lấy file chạy từ gói npm và đặt vào /usr/local/bin
npm pack go-ios@1.3.2
tar -xzf go-ios-1.3.2.tgz package/dist/go-ios-linux-amd64_linux_amd64/ios   # máy ARM: go-ios-linux-arm64_linux_arm64
sudo install -m 755 package/dist/go-ios-linux-amd64_linux_amd64/ios /usr/local/bin/ios
ios version

# Cắm iPhone, mở khóa, rồi ghép đôi (bấm "Tin cậy" trên iPhone)
ios list --details
ios pair --udid=<UDID>

# iOS 16+: bật Developer Mode nếu chưa bật (iPhone sẽ khởi động lại)
ios devmode enable --udid=<UDID>

# Gắn Developer Disk Image (iOS 17+: chạy "ios tunnel start --userspace" trước)
ios image auto --udid=<UDID>
```

### 5.3. Windows (PowerShell)

1. Cài **Apple Devices** từ Microsoft Store (hoặc iTunes). Ứng dụng này cài driver USB và dịch vụ kết nối iPhone mà go-ios cần.
2. Cài Node.js LTS từ nodejs.org.
3. Cài go-ios:

```powershell
npm pack go-ios@1.3.2
tar -xzf go-ios-1.3.2.tgz
New-Item -ItemType Directory -Force C:\tools | Out-Null
Copy-Item package\dist\go-ios-windows-amd64_windows_amd64\ios.exe C:\tools\ios.exe
$env:Path += ";C:\tools"          # thêm C:\tools vào PATH vĩnh viễn trong System Properties nếu muốn
ios version
```

4. Cắm iPhone, mở khóa, bấm "Tin cậy", rồi chạy các lệnh giống Linux: `ios list --details`, `ios pair`, `ios devmode enable` (iOS 16+), `ios image auto`.

## 6. Mang WDA sang máy khác: build và ký trên Mac, cài ở mọi nơi

### 6.1. Bản build sẵn

Repo có sẵn WDA đã build nhưng **chưa ký**: `prebuilt/wda/WebDriverAgentRunner-Runner.zip` (WDA 16.15.0, Xcode 26.6, iOS 15 trở lên, đã vá để chạy được trên iOS 15/16). Thông tin chi tiết ở `prebuilt/wda/manifest.json`. Tạo lại trên Mac:

```bash
node scripts/build-wda-prebuilt.cjs            # hoặc thêm phiên bản: ... 16.15.0
```

### 6.2. Ký trên Mac (đã thử trên iPhone 7 và iPhone 12 mini)

Cần một provisioning profile chứa UDID của **mọi iPhone** sẽ dùng. Cách dễ nhất: bấm **Chuẩn bị WDA** trong ứng dụng với từng máy đang cắm, hoặc mở Xcode với máy đang cắm, để Xcode thêm máy vào profile. Profile nằm trong `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`.

Các lệnh ký từng bước nằm ở [prebuilt/wda/README.md](../prebuilt/wda/README.md). Điểm quan trọng: phải ký **từ trong ra ngoài**, theo thứ tự: framework trong `PlugIns/WebDriverAgentRunner.xctest/Frameworks/`, rồi `WebDriverAgentRunner.xctest`, rồi các framework trong `Frameworks/`, cuối cùng là app (kèm entitlements). Thiếu bước đầu thì WDA báo `Library not loaded: @rpath/WebDriverAgentLib.framework`.

### 6.3. Đóng gói thành .ipa để chép sang máy khác

```bash
mkdir -p Payload && cp -R WebDriverAgentRunner-Runner.app Payload/
ditto -c -k --keepParent Payload WebDriverAgent-signed.ipa
```

Chép `WebDriverAgent-signed.ipa` sang máy Linux/Windows, rồi:

```bash
ios install --path=WebDriverAgent-signed.ipa --udid=<UDID>
```

Sau đó chạy WDA như mục 4.3, từ bước 4.

Giới hạn với tài khoản Apple miễn phí:

- File đã ký chỉ cài được lên các iPhone có trong profile.
- Hết hạn sau 7 ngày: phải ký lại trên Mac và chép lại.
- File đã ký có chứa danh sách UDID và email Apple ID: **không commit lên repo công khai**.

Tài khoản Apple Developer trả phí bỏ được các giới hạn này (profile 1 năm, đăng ký máy qua App Store Connect API). Ký trực tiếp trên Linux/Windows bằng công cụ như `zsign` (cần file chứng chỉ `.p12`, mật khẩu và profile) là một hướng khác, chưa được thử với dự án.

## 7. Appium điều khiển WDA đang chạy (mọi hệ điều hành)

Khi WDA đã chạy (mục 4.3), Appium chỉ cần gắn vào nó qua HTTP. Đây đúng là cách ứng dụng làm với máy chạy WDA bằng go-ios.

```bash
npm install -g appium
appium driver install xcuitest
appium --address 127.0.0.1 --port 4723
```

Capabilities khi tạo session (đã thử trên Mac):

```json
{
  "platformName": "iOS",
  "appium:automationName": "XCUITest",
  "appium:udid": "<UDID>",
  "appium:webDriverAgentUrl": "http://127.0.0.1:8101",
  "appium:platformVersion": "15.8.8",
  "appium:noReset": true,
  "appium:skipLogCapture": true
}
```

- `webDriverAgentUrl`: địa chỉ WDA (port đã forward, hoặc `http://<IP iPhone>:8100`).
- `platformVersion`: phiên bản iOS của máy. Thiếu nó, Appium sẽ tự hỏi iPhone qua USB và báo `Could not find the expected device` khi chỉ có kết nối mạng.
- `noReset` và `skipLogCapture`: để Appium chỉ nói chuyện với WDA, không đụng tới kết nối USB.
- **Không** gửi `appium:bundleId`. Mở MyVinpearl bằng lệnh `mobile: activateApp` sau khi tạo session.

Trên Linux/Windows, driver XCUITest chỉ hoạt động theo kiểu này, với UDID ghi rõ (chưa thử).

## 8. Lỗi thường gặp

| Thông báo | Nguyên nhân | Cách xử lý |
|---|---|---|
| `zsh: command not found: ios` | go-ios không nằm trong PATH | Xem mục 4.1 |
| `Logic Testing Unavailable` | Xcode 26.4+ không chạy được XCUITest trên iPhone iOS 15/16 | Bấm Health hoặc Chuẩn bị WDA để ứng dụng chạy WDA bằng go-ios |
| `Library not loaded: @rpath/lib_TestingInterop.dylib` hoặc `_Testing_Foundation` (trong `ios syslog`) | WDA build bằng Xcode 26 chưa được vá cho iOS 15/16 | Dùng bản build sẵn hoặc Chuẩn bị WDA |
| `Library not loaded: @rpath/WebDriverAgentLib.framework` | Ký lại thiếu framework lồng bên trong | Ký từ trong ra ngoài (mục 6.2) |
| `Device not found` / `Mac không thấy iPhone này qua USB` | Chưa cắm cáp, máy đang khóa, chưa bấm Tin cậy | Cắm cáp, mở khóa, `ios list` để kiểm tra |
| `manualPairingTunnelStart: unsupported iOS version 15.x` (log tunnel) | iOS 15/16 không dùng tunnel | Bình thường, bỏ qua |
| `go-ios agent is not running` (cảnh báo) | Chưa mở tunnel | iOS 16 trở xuống: bỏ qua. iOS 17+: chạy `ios tunnel start --userspace` |
| Chế độ automation trên iPhone tự tắt | Có tiến trình khác cài hoặc chạy WDA cùng bundle ID, đã dừng `ios runwda`, rút cáp, hoặc khởi động lại Appium | Không chạy lệnh go-ios bằng tay trên máy ứng dụng đang dùng. Bấm Health để chạy lại |
| `Port 8100 trên Mac đang được "…" dùng` | Hai máy USB trùng port trên Mac | Để trống ô port để ứng dụng tự cấp |
| `no such column: account_id` | Đang chạy code cũ trên database mới | Tắt và chạy lại `npm run dev` |
| `Profile WDA đã hết hạn` | Profile 7 ngày đã hết | Cắm máy, bấm Chuẩn bị WDA |
| `Provisioning profile của WDA chưa có UDID iPhone này` | Máy chưa được Xcode đăng ký vào Team | Mở Xcode với máy đang cắm (Window › Devices and Simulators), rồi Chuẩn bị WDA |
| `Không kết nối được WDA tại http://…` | WDA không chạy hoặc khác mạng | Kiểm tra `curl http://<địa chỉ>/status`, chạy lại WDA |
