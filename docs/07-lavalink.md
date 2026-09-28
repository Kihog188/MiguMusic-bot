# Lavalink

Từ 28/09/2026 bot không tự giải mã và encode âm thanh nữa. Việc đó giao cho
**Lavalink** — một máy chủ Java chạy cạnh bot, nhận lệnh "phát bài này" và tự
đẩy luồng Opus vào kênh thoại Discord. Bot chỉ còn lo hàng đợi và lệnh.

## Vì sao đổi

| | Trước (yt-dlp → ffmpeg → opusscript) | Sau (Lavalink) |
|---|---|---|
| Mỗi bài | spawn 2 tiến trình | 1 lệnh REST |
| `/filter` | phát lại bài từ đầu | áp ngay, không ngắt |
| Nguồn | chỉ YouTube | YouTube, SoundCloud, Bandcamp, Twitch, Vimeo, link HTTP |
| Gói native | `@discordjs/opus`, `libsodium`... (từng build lỗi) | không còn |

## YouTube vẫn bị chặn — và cách bot xử lý

Lavalink **không** giải quyết chuyện YouTube chặn IP datacenter. Đã thử
Lavalink 4.2.2 + youtube-source 1.18.2 + OAuth trên EC2: vẫn
`AllClientsFailedException` với đúng những video yt-dlp bị chặn. Xem
[03-youtube-cookies.md](03-youtube-cookies.md).

Nên bot chạy kiểu lai:

1. Tìm bài / lấy playlist bằng Lavalink. Hỏng thì quay về yt-dlp + yt-search.
2. Phát bằng Lavalink. Nếu Lavalink báo `loadFailed` với bài YouTube, bot tự
   chuyển bài đó sang **yt-dlp (có cookies)**: yt-dlp chỉ lấy link audio
   trực tiếp (`googlevideo.com/...`), rồi đưa link đó cho Lavalink phát qua
   nguồn `http`.
3. Link `googlevideo` gắn với IP đã xin nó, nên **Lavalink phải chạy cùng máy
   với bot**.

Trên EC2, đặt `YT_VIA_YTDLP=1` trong `.env` để bỏ luôn bước thử Lavalink với
YouTube — đằng nào cũng hỏng, bỏ qua thì bài bắt đầu nhanh hơn vài giây.
Nguồn khác (SoundCloud...) vẫn đi thẳng Lavalink.

## Cài trên máy chủ

### 1. Java 17+ và swap

```bash
sudo apt install -y openjdk-21-jre-headless
```

`t3.micro` chỉ có ~911 MiB RAM, trước đây đã dùng ~461 MiB. Lavalink với
`-Xmx384m` ăn thêm ~450–550 MiB → **phải có swap**, không thì OOM killer sẽ
giết bot:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2. Tải Lavalink

```bash
cd ~/bot/lavalink
curl -L -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar
```

Cấu hình nằm sẵn trong repo: [lavalink/application.yml](../lavalink/application.yml).
Plugin YouTube tự tải về `lavalink/plugins/` lần chạy đầu. Jar, plugin và log
đã chặn trong `.gitignore`.

### 3. Service `lavalink`

`/etc/systemd/system/lavalink.service`:

```ini
[Unit]
Description=Lavalink
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/bot/lavalink
EnvironmentFile=/home/ubuntu/bot/.env
ExecStart=/usr/bin/java -Xmx384m -jar Lavalink.jar
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`EnvironmentFile` để Lavalink đọc cùng `LAVALINK_PASSWORD` với bot.

Thêm vào mục `[Unit]` của `zam-bot.service`:

```ini
After=network-online.target lavalink.service
Wants=lavalink.service
```

Bot khởi động trước Lavalink cũng không sao — bot tự thử kết nối lại mỗi 5
giây cho tới khi được.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lavalink
journalctl -u lavalink -f   # chờ dòng "Lavalink is ready to accept connections"
```

### 4. Cập nhật bot

```bash
cd ~/bot && git pull && npm install --omit=dev
```

Thêm vào `.env`:

```
LAVALINK_URL=127.0.0.1:2333
LAVALINK_PASSWORD=<chuỗi ngẫu nhiên>
YT_VIA_YTDLP=1
```

`YTDL_COOKIES` giữ nguyên. Service `pot-provider` giữ nguyên — yt-dlp vẫn dùng.

```bash
npm run deploy                 # đăng ký lại lệnh (mô tả /filter đổi)
sudo systemctl restart zam-bot
```

## Kiểm tra nhanh

```bash
# Lavalink sống không
curl -s -H "Authorization: $LAVALINK_PASSWORD" http://127.0.0.1:2333/version

# Lavalink tìm được bài không
curl -s -H "Authorization: $LAVALINK_PASSWORD" \
  "http://127.0.0.1:2333/v4/loadtracks?identifier=ytsearch:son%20tung" | head -c 300
```

## Log đáng chú ý

| Dòng log bot | Nghĩa |
|---|---|
| `Lavalink "main" đã sẵn sàng.` | kết nối Lavalink OK |
| `Mất kết nối Lavalink` | Lavalink chết/khởi động lại; bot tự nối lại, hàng đợi cũ bị xoá |
| `Lavalink không phát được "...", chuyển sang yt-dlp.` | bình thường trên EC2 nếu chưa bật `YT_VIA_YTDLP` |
| `Không phát được "..."` | cả hai đường đều hỏng — thường là cookies chết |
