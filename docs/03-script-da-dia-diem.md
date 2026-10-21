# Module script đa địa điểm

Màn hình **Workflows → Chạy nhiều địa điểm** nhận nhiều khách sạn trong một lần chạy. Module `src/main/automation-script.ts` xác thực input, tạo một workflow VinClub cho từng địa điểm và chạy tuần tự. Kết quả trả về theo từng địa điểm, gồm trạng thái và log các action.

## Input

```json
{
  "credentialRef": "vinclub-default",
  "paymentPlan": "VEC-08-25",
  "locations": [
    {
      "name": "Melia Vinpearl Da Nang Riverfront",
      "checkIn": "2026-12-17",
      "checkOut": "2026-12-18",
      "rooms": 1,
      "adults": 1,
      "children": 0,
      "infants": 0
    },
    {
      "name": "Vinpearl Resort Nha Trang",
      "checkIn": "2026-12-20",
      "checkOut": "2026-12-21",
      "rooms": 2,
      "adults": 2,
      "children": 0,
      "infants": 0
    }
  ]
}
```

`credentialRef` chỉ là tên tham chiếu; bản hiện tại chưa kết nối Windows Credential Manager nên không phân giải mật khẩu. Có thể truyền `username` thay cho `credentialRef` khi chạy preview. Giới hạn 1–50 địa điểm/lần; ngày `checkOut` phải sau `checkIn`.

## Thực thi hiện tại

1. Xác thực toàn bộ input trước khi bắt đầu.
2. Gán `hotel`, `checkIn`, `checkOut`, `rooms`, `adults`, `children`, `infants` cho workflow của từng địa điểm.
3. Chạy tuần tự bằng preview runner.
4. Trả kết quả và log riêng cho từng địa điểm. Step cuối là `stop` trước hành động đặt phòng.

Các action UI vẫn là **preview**, không gửi tap/input xuống iPhone. `SSHCommandEngine` đã có thể chạy command system qua IPC sau khi host fingerprint được trust; nó không biến SSH thành UI automation. Để chạy thật các action VinClub cần agent UI automation đã kiểm chứng trên iPhone và credential store. Không nên đưa password vào JSON input hay workflow template.

## Kiểm tra

```bash
npm run build
npm run check:workflow
```

Self-check dùng hai địa điểm mẫu, xác nhận cả hai được xử lý và mỗi workflow dừng tại safe stop.
