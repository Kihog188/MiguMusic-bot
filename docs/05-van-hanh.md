# Vận hành hằng ngày

## Kết nối

```powershell
ssh -i D:\BOT\BOT\zam-bot-key.pem ubuntu@<IP>
```

Thay `<IP>` bằng địa chỉ thật, **xoá cả dấu ngoặc nhọn**. Lấy IP trong EC2
console → Instances → cột *Public IPv4 address*.

Nếu OpenSSH báo khoá có quyền quá mở:

```powershell
icacls D:\BOT\BOT\zam-bot-key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

Không cần vào hẳn máy chủ mới chạy được lệnh — nối thẳng vào sau lệnh `ssh`:

```powershell
ssh -i D:\BOT\BOT\zam-bot-key.pem ubuntu@<IP> "journalctl -u zam-bot -n 50 --no-pager"
```

## Xem log

| Mục đích | Lệnh |
|---|---|
| Trực tiếp, chạy tới đâu hiện tới đó | `journalctl -u zam-bot -f` |
| 100 dòng cuối | `journalctl -u zam-bot -n 100` |
| 10 phút gần đây | `journalctl -u zam-bot --since "10 min ago"` |
| Chỉ lỗi | `journalctl -u zam-bot -p err` |
| Tìm chữ cụ thể | `journalctl -u zam-bot \| grep -i "lỗi"` |
| Tóm tắt nhanh | `systemctl status zam-bot` |
| Dung lượng log đang chiếm | `journalctl --disk-usage` |

Thêm `--no-pager` để in thẳng thay vì mở trình xem.

`Ctrl+C` để thoát chế độ `-f` — **bot vẫn chạy tiếp**, bạn chỉ ngắt việc xem.

Trình xem mặc định là `less`: `↑↓` cuộn, `G` xuống cuối, `/chữ` tìm kiếm,
`q` thoát.

## Điều khiển dịch vụ

```bash
sudo systemctl restart zam-bot       # khoi dong lai bot
sudo systemctl stop zam-bot          # dung han
sudo systemctl start zam-bot         # chay lai
sudo systemctl status zam-bot        # trang thai

sudo systemctl restart pot-provider  # tuong tu cho POT provider
```

Kiểm tra cả hai còn tự bật sau reboot không:

```bash
systemctl is-enabled zam-bot pot-provider   # ca hai phai la "enabled"
```

## Cập nhật code

Sau khi push code mới lên GitHub:

```bash
cd ~/bot && git pull && npm install --omit=dev && sudo systemctl restart zam-bot
```

Nếu `git pull` báo xung đột vì có sửa tay trên máy chủ, xem thử đã sửa gì:

```bash
cd ~/bot && git status && git diff
```

## Kiểm tra tài nguyên

```bash
free -h            # RAM va swap
df -h /            # dung luong dia
uptime             # tai he thong
systemctl status zam-bot | grep -E 'Memory|CPU'
```

---

# Xử lý sự cố

## Bot không lên mạng

```bash
systemctl status zam-bot
journalctl -u zam-bot -n 50
```

Nguyên nhân hay gặp:

| Triệu chứng trong log | Nguyên nhân | Cách sửa |
|---|---|---|
| `TokenInvalid` / `401` | `.env` thiếu hoặc sai token | Kiểm tra `grep -o '^[A-Z_]*' ~/bot/.env` |
| `Cannot find module` | Thiếu dependency | `cd ~/bot && npm install --omit=dev` |
| Khởi động lại liên tục | Crash lúc boot | Xem log đầy đủ, `systemctl stop zam-bot` để dừng vòng lặp |

## `/play` báo lỗi

**`Sign in to confirm you're not a bot`** → cookies hết hạn. Xem
[03-youtube-cookies.md](03-youtube-cookies.md).

**`HTTP Error 403`** → thường cũng là vấn đề cookies, hoặc `yt-dlp` quá cũ:

```bash
~/bot/node_modules/youtube-dl-exec/bin/yt-dlp --update-to nightly
```

**Không có lỗi nhưng không ra tiếng** → kiểm tra POT provider còn sống không:

```bash
systemctl status pot-provider
ss -tlnp | grep 4416          # phai la 127.0.0.1
```

## Bot chết đột ngột, log cụt giữa chừng

Nhiều khả năng bị kernel giết vì hết RAM:

```bash
journalctl -u zam-bot | grep -i "oom\|killed"
dmesg | grep -i "out of memory"
free -h
```

Nếu đúng: kiểm tra swap còn bật không (`swapon --show`). Nếu swap vẫn bật mà
vẫn OOM thì đã tới lúc nâng lên `t3.small`.

## Bot ngắt quãng vào giờ lạ

Nghi phạm đầu tiên là `unattended-upgrades` của Ubuntu — nó chạy nền và có thể
khởi động lại dịch vụ:

```bash
journalctl -u unattended-upgrades --since "1 hour ago"
```

## Không SSH được

Thường là IP nhà bạn đã đổi, trong khi security group chỉ cho phép IP cũ.

EC2 console → Security Groups → `zam-bot-sg` → Edit inbound rules → sửa luật
SSH thành **My IP**.

**Đừng đổi thành `0.0.0.0/0`** — máy sẽ bị bot quét SSH trong vài phút.

## Lỗi `DiscordAPIError[10062] Unknown interaction`

Token của interaction hết hạn. Discord chỉ cho 3 giây để trả lời lần đầu.

Đã sửa trong commit `b135a77`: lệnh `/filter` giờ gọi `deferReply()` trước khi
làm việc nặng, và khối `catch` bỏ qua mã `10062`/`40060` thay vì thử trả lời
tiếp cho rác log.

Nếu lỗi này xuất hiện ở lệnh khác: nguyên tắc là **mọi lệnh phải gọi `reply()`
hoặc `deferReply()` trước bất kỳ `await` nào**. `deferReply()` mua thêm 15 phút.
