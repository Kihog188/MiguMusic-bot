# Tài liệu vận hành ZamMusic Bot

Thư mục này ghi lại toàn bộ quá trình đưa bot từ chạy trên laptop lên chạy
24/7 trên máy chủ, kèm lý do đằng sau từng quyết định. Viết để đọc lại sau
nhiều tháng mà vẫn hiểu được.

## Mục lục

| Tài liệu | Nội dung |
|---|---|
| [01-ha-tang.md](01-ha-tang.md) | Máy chủ đang chạy ở đâu, cấu hình gì, vì sao chọn vậy |
| [02-cai-dat-tu-dau.md](02-cai-dat-tu-dau.md) | Dựng lại toàn bộ từ con số không nếu mất máy |
| [03-youtube-cookies.md](03-youtube-cookies.md) | Vì sao bị chặn và cách nuôi cookies |
| [04-do-hieu-nang.md](04-do-hieu-nang.md) | Số liệu đo thật, dùng để quyết định nâng cấp |
| [05-van-hanh.md](05-van-hanh.md) | Lệnh dùng hằng ngày, xử lý sự cố |
| [06-nhat-ky.md](06-nhat-ky.md) | Nhật ký thay đổi theo thời gian |
| [07-lavalink.md](07-lavalink.md) | Lavalink: vì sao dùng, cách cài, cách chạy chung với yt-dlp |

## Tra cứu nhanh

```bash
# Vao may
ssh -i D:\BOT\BOT\zam-bot-key.pem ubuntu@<IP>

# Xem log truc tiep
journalctl -u zam-bot -f
journalctl -u lavalink -f

# Khoi dong lai
sudo systemctl restart zam-bot

# Cap nhat code moi tu GitHub
cd ~/bot && git pull && npm install --omit=dev && sudo systemctl restart zam-bot
```

## Ba thứ bí mật, không bao giờ đưa lên GitHub

| File | Chứa gì | Mất thì sao |
|---|---|---|
| `.env` | `DISCORD_TOKEN` | Người khác chiếm quyền điều khiển bot |
| `cookies.txt` | Phiên đăng nhập Google | Người khác truy cập tài khoản đó |
| `zam-bot-key.pem` | Khoá SSH | Người khác vào được máy chủ |

Cả ba đã được chặn trong `.gitignore` bằng mẫu `*cookies*.txt`, `*.pem`,
`*.key` và `.env`. **Khoá `.pem` chỉ tải được một lần lúc tạo** — mất là mất
quyền vào máy vĩnh viễn, phải tạo instance mới.
