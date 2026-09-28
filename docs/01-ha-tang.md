# Hạ tầng

## Máy chủ hiện tại

| Mục | Giá trị |
|---|---|
| Nhà cung cấp | AWS EC2 |
| Region | Asia Pacific (Singapore) `ap-southeast-1` |
| Instance type | `t3.micro` — 2 vCPU, 1 GiB RAM |
| Hệ điều hành | Ubuntu Server 24.04 LTS, 64-bit x86 |
| Ổ đĩa | 16 GiB gp3 |
| Credit specification | **Standard** (không phải Unlimited) |
| Swap | 2 GiB, `vm.swappiness=10` |
| User SSH | `ubuntu` |
| Thư mục bot | `/home/ubuntu/bot` |

IP public **đổi mỗi lần stop rồi start lại** instance. Không lưu cứng ở đâu cả —
lấy lại trong EC2 console mục Instances, cột *Public IPv4 address*. Việc đổi IP
không ảnh hưởng bot vì bot chỉ kết nối ra ngoài, chỉ ảnh hưởng lệnh SSH của bạn.

## Hai dịch vụ systemd

| Service | Vai trò | Cổng |
|---|---|---|
| `zam-bot` | Bot Discord | không mở cổng nào |
| `pot-provider` | Sinh PO token cho yt-dlp | `127.0.0.1:4416` (chỉ nội bộ) |

Cả hai đều `enabled` (tự chạy sau reboot) và `Restart=always` (tự dậy nếu crash).

`pot-provider` **bắt buộc chỉ nghe trên `127.0.0.1`**. Nếu mở ra `0.0.0.0` thì
bất kỳ ai trên internet cũng gọi được, tài liệu của dự án cảnh báo nguy cơ thực
thi mã từ xa.

## Tường lửa (security group)

Chỉ đúng một luật vào:

| Type | Port | Source |
|---|---|---|
| SSH | 22 | **My IP** |

Không mở HTTP, HTTPS, hay bất cứ cổng nào khác. Bot chủ động kết nối ra Discord
chứ không nhận kết nối vào; security group của AWS là *stateful* nên gói trả về
tự thông. Voice chạy qua UDP đi ra, cũng không cần mở cổng vào.

Nếu IP nhà bạn đổi, phải sửa lại luật này thì mới SSH được. **Đừng đổi thành
`0.0.0.0/0`** — máy sẽ bị bot quét SSH trong vài phút.

## Vì sao chọn như vậy

**Region Singapore.** Bot gửi gói UDP voice mỗi 20 ms; độ trễ từ Singapore về
Việt Nam khoảng 30–50 ms, còn từ region Mỹ là 200 ms+. Đây là thứ duy nhất
**không sửa được** sau khi tạo — chọn sai phải dựng lại máy.

**`t3.micro` chứ không phải lớn hơn.** Đo thực tế cho thấy mỗi luồng nhạc tốn
~5,3% một core, trong khi `t3.micro` cho 20% một core chạy liên tục. Dư gấp gần
4 lần. Chi tiết ở [04-do-hieu-nang.md](04-do-hieu-nang.md). Nâng cấp về sau chỉ
mất 2 phút (stop → change instance type → start) nên không việc gì phải mua thừa
ngay từ đầu.

**Credit specification = Standard.** AWS để mặc định là `Unlimited`, nghĩa là
vượt baseline sẽ **bị tính tiền thêm**. Đổi sang `Standard` thì vượt chỉ bị giảm
tốc, chặn hoàn toàn khả năng phát sinh hoá đơn ngoài dự tính.

**Ubuntu 24.04 chứ không phải 26.04.** Bản 26.04 quá mới, các repo bên thứ ba
(NodeSource) thường chậm hỗ trợ. 24.04 có sẵn mọi thứ và nhiều tài liệu khi gặp
lỗi.

**x86 chứ không phải Arm.** Arm chạy được về mặt kỹ thuật (mọi binary phụ thuộc
đều có bản arm64), nhưng chương trình dùng thử `t4g` miễn phí của AWS đã hết hạn
cuối 2025 nên Arm không còn lợi thế giá.

## Chi phí ước tính

Giá list Singapore, chạy 24/7, **cần tự đối chiếu lại** vì giá thay đổi:

```
t3.micro  0,0132 USD/h x 730h  =  9,64
EBS 16 GB gp3                  =  1,54
IPv4 public 0,005 USD/h        =  3,65
Egress ~32 GB (duoi 100 GB free) = 0,00
                          tong ~ 14,83 USD/thang
```

Nếu tài khoản thuộc free tier kiểu cũ (750 giờ/tháng `t3.micro` miễn phí trong
12 tháng) thì gần như không mất gì. Nếu thuộc kiểu credit mới thì 100 USD chạy
được ~205 ngày, nhưng **credit hết hạn sau 6 tháng** nên thực tế dừng ở ~180 ngày.

Kiểm tra mình thuộc loại nào: Billing and Cost Management → Free tier.

Nên đặt cảnh báo: Billing → Budgets → Cost budget, ngưỡng 5 USD/tháng.
