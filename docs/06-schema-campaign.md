# Schema input Campaign

Campaign là đơn vị cấu hình duy nhất của sản phẩm. Thiết bị và tài khoản nằm ở `targets` (`deviceId` + `accountId`), còn dữ liệu thay đổi theo đợt chạy nằm ở `inputs`. Mật khẩu vẫn chỉ nằm trong macOS Keychain.

```json
{
  "name": "Hà Tĩnh - tháng 01/2027",
  "status": "draft",
  "inputs": {
    "paymentYear": 2027,
    "locationQuery": "ha tinh",
    "hotel": "Vinpearl Ha Tinh Affiliated by Meliá",
    "checkIn": "2027-01-16",
    "checkOut": "2027-01-17",
    "rooms": 1,
    "adults": 1,
    "children": 0,
    "infants": 0,
    "roomType": "Deluxe Twin",
    "roomPoints": "20 điểm/đêm"
  },
  "targets": [
    { "deviceId": 1, "accountId": 1 }
  ]
}
```

`paymentYear` là giá trị được bấm trên màn hình chọn gói thanh toán; không lưu hoặc tìm theo mã gói. `roomType` và `roomPoints` là bắt buộc, dùng để xác thực đúng phòng trước khi đặt. Account đã chọn cung cấp session và hồ sơ người đặt; device đã chọn là iPhone thực thi.

Các campaign bị từ chối nếu thiếu `paymentYear`, `roomType`, ngày không hợp lệ, số khách ngoài phạm vi hoặc có `password`/`secret`/`credential` trong JSON.

Campaign ở trạng thái `draft` chỉ có thể **Chạy test**. Test chạy tới màn `Xác nhận thanh toán` rồi dừng bắt buộc, không bấm `Xác nhận`. Campaign `archived` không thể chạy.
