# WebDriverAgent build sẵn (chưa ký)

`WebDriverAgentRunner-Runner.zip` là WebDriverAgent (Appium) build từ mã nguồn npm gốc, **chưa ký**, chạy được trên mọi iPhone iOS 15 trở lên (arm64) sau khi ký lại cho máy đó. Chi tiết phiên bản, Xcode đã dùng và SHA-256 nằm trong `manifest.json`.

Khác bản build thường:

- đã chép `lib_TestingInterop.dylib` và `_Testing_Foundation.framework` vào `Frameworks/`: Xcode 26 liên kết runner với Swift Testing, thứ chỉ iOS 26 có sẵn; thiếu hai file này WDA chết ngay khi mở trên iOS 15/16 (trên iOS 26, dyld dùng bản của hệ thống);
- không có dSYM, profile, chứng chỉ hay bundle ID cá nhân (`com.facebook.*`, được đổi khi ký).

Tạo lại (macOS + Xcode): `node scripts/build-wda-prebuilt.cjs [phiên bản appium-webdriveragent]`.

## Ký lại cho một iPhone (macOS, đã thử trên iPhone 7 iOS 15.8.8)

Cần một provisioning profile development có UDID của máy và chứng chỉ tương ứng trong Keychain. Với `<APPID>` là app id trong profile bỏ Team ID (ví dụ `net.example.WebDriverAgentRunner.xctrunner`):

```bash
ditto -x -k WebDriverAgentRunner-Runner.zip out && APP=out/WebDriverAgentRunner-Runner.app && X=$APP/PlugIns/WebDriverAgentRunner.xctest
cp profile.mobileprovision $APP/embedded.mobileprovision
security cms -D -i $APP/embedded.mobileprovision > profile.plist && plutil -extract Entitlements xml1 -o ent.plist profile.plist
plutil -replace CFBundleIdentifier -string "<APPID>" $APP/Info.plist
plutil -replace CFBundleIdentifier -string "<APPID bỏ .xctrunner>" $X/Info.plist
# Ký từ trong ra ngoài: framework của xctest, xctest, framework của app, rồi app kèm entitlements.
for f in $X/Frameworks/* $X $APP/Frameworks/*; do codesign -f -s "<SHA-1 chứng chỉ>" "$f"; done
codesign -f -s "<SHA-1 chứng chỉ>" --entitlements ent.plist $APP
ios install --path=$APP --udid=<UDID>
ios runwda --bundleid=<APPID> --testrunnerbundleid=<APPID> --xctestconfig=WebDriverAgentRunner.xctest --udid=<UDID>
```

Trên Linux/Windows có thể ký bằng công cụ như `zsign` (cần file `.p12` + mật khẩu + profile) và cài/chạy bằng go-ios; cách này **chưa được thử** với dự án.
