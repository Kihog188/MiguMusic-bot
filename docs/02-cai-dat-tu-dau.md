# Dựng lại từ con số không

Làm theo đúng thứ tự này nếu mất máy hoặc muốn chuyển sang máy khác.

## Phần A — Tạo instance trên AWS console

### 0. Region

Góc trên bên phải console → **Asia Pacific (Singapore) `ap-southeast-1`**.

Làm trước tiên. Đây là thứ duy nhất không sửa được sau này.

Rồi vào **EC2 → Instances → Launch instances**.

### 1–8. Các mục trong trình tạo

| Mục | Giá trị |
|---|---|
| Name | `zam-music-bot` |
| AMI | Ubuntu Server 24.04 LTS, **64-bit (x86)** |
| Instance type | `t3.micro` |
| Key pair | Create new · ED25519 · định dạng `.pem` |
| Auto-assign public IP | Enable |
| Security group | Tạo mới, **chỉ** SSH (22) từ **My IP** |
| Storage | 16 GiB **gp3**, File systems = **None** |
| Storage → Advanced | Encrypted, key mặc định `aws/ebs` (miễn phí) |
| **Advanced details → Credit specification** | **`Standard`** |

Hai mục dễ bỏ sót nhất: **Credit specification** (mặc định là `Unlimited`, phải
đổi) và việc **bỏ tick HTTP/HTTPS** trong Network settings.

File `.pem` **chỉ tải được một lần**. Lưu vào `D:\BOT\BOT\zam-bot-key.pem`.

Dòng cảnh báo nâu về *instance store volumes* là thông báo thông tin, bỏ qua được.

## Phần B — Cài đặt trên máy chủ

### B1. Kết nối

Chạy trên **máy bạn** (PowerShell):

```powershell
icacls D:\BOT\BOT\zam-bot-key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i D:\BOT\BOT\zam-bot-key.pem ubuntu@<IP>
```

Lệnh `icacls` bắt buộc — OpenSSH từ chối dùng khoá có quyền quá mở.

Thay `<IP>` bằng địa chỉ thật, **xoá cả dấu ngoặc nhọn**.

Từ B2 trở đi là chạy **trên máy chủ**. Nhận biết bằng dòng nhắc:
`ubuntu@ip-172-31-x-x:~$`

### B2. Cập nhật + swap

```bash
sudo apt update && sudo apt upgrade -y

sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
free -h
```

Swap bắt buộc. Máy chỉ có 1 GB, mỗi lượt `/play` sinh một tiến trình `yt-dlp`
tốn ~100 MB — nhiều lượt trùng nhau sẽ bị kernel giết tiến trình nếu thiếu.

Xác nhận: `free -h` hiện `Swap: 2.0Gi`.

### B3. Node 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential
node -v && npm -v && python3 -V
```

`build-essential` cần để biên dịch `@discordjs/opus` — xem mục cuối trang.

`python3` cần cho `yt-dlp`: bản Linux là zipapp Python chứ không phải file đóng
gói sẵn như `yt-dlp.exe` trên Windows. Ubuntu có sẵn, không phải cài.

### B4. Tải bot

```bash
cd ~
git clone https://github.com/Kihog188/MiguMusic-bot.git bot
cd bot
npm install --omit=dev
```

### B5. Tạo `.env`

File này bị gitignore nên không có trong repo. Chép từ máy bạn:

```powershell
scp -i D:\BOT\BOT\zam-bot-key.pem D:\BOT\BOT\.env ubuntu@<IP>:/home/ubuntu/bot/.env
```

Hoặc gõ tay trên máy chủ bằng `nano ~/bot/.env`. Cần 3 biến:
`DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` — cộng thêm `YTDL_COOKIES` ở bước sau.

```bash
chmod 600 ~/bot/.env
```

### B6. Đăng ký slash command

```bash
cd ~/bot && node deploy-commands.js
```

### B7. systemd cho bot

```bash
sudo tee /etc/systemd/system/zam-bot.service > /dev/null <<'EOF'
[Unit]
Description=Zam Music Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/bot
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now zam-bot
journalctl -u zam-bot -f
```

Xác nhận: log hiện `Đã đăng nhập với tên ZamMusic#8063`.

### B8. POT token provider

```bash
cd ~
git clone --single-branch --branch 2.0.0 \
  https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
cd bgutil-ytdlp-pot-provider/server
npm ci
npx tsc

sudo tee /etc/systemd/system/pot-provider.service > /dev/null <<'EOF'
[Unit]
Description=BgUtil POT Provider (YouTube proof-of-origin token)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/bgutil-ytdlp-pot-provider/server
ExecStart=/usr/bin/node build/main.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now pot-provider

# Kiem tra: PHAI la 127.0.0.1, KHONG duoc 0.0.0.0
ss -tlnp | grep 4416
```

Cài plugin cho yt-dlp:

```bash
cd /tmp
curl -sL -o plugin.zip \
  https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/2.0.0/bgutil-ytdlp-pot-provider.zip
mkdir -p ~/.config/yt-dlp/plugins/bgutil
python3 -c "import zipfile,os;zipfile.ZipFile('plugin.zip').extractall(os.path.expanduser('~/.config/yt-dlp/plugins/bgutil'))"
```

> Tên file release là `bgutil-ytdlp-pot-provider.zip`. README của dự án có chỗ
> ghi tên khác (`bgutil-ytdlp-ytdlp-pot-provider.zip`) và link đó trả về 404.

Xác nhận plugin nạp được:

```bash
~/bot/node_modules/youtube-dl-exec/bin/yt-dlp -v --simulate \
  'https://youtu.be/dQw4w9WgXcQ' 2>&1 | grep -i 'PO Token Providers'
```

Phải thấy `bgutil:http-2.0.0 (external)`.

### B9. Cookies YouTube

Xem [03-youtube-cookies.md](03-youtube-cookies.md). Đây là bước **bắt buộc**,
không có cookies thì phần lớn video nhạc sẽ bị chặn.

---

## Ghi chú: `@discordjs/opus` và vấn đề glibc

`npm install` sẽ thất bại nếu thiếu `build-essential`. Lý do:

`node-pre-gyp` nhét **phiên bản glibc đang chạy** vào tên file cần tải:

```
opus-v0.10.0-node-v127-napi-v3-linux-x64-glibc-2.39.tar.gz   -> 404
```

Dự án chỉ build sẵn cho `glibc-2.31` (Ubuntu 20.04) và `glibc-2.35`
(Ubuntu 22.04). Ubuntu 24.04 dùng glibc **2.39** nên không khớp bản nào, buộc
phải biên dịch từ source — cần `make` và `g++`.

Trên Ubuntu 24.04 chỉ mất ~40 giây, không đáng lo. Nhưng nếu muốn tránh hẳn:
gói này **không bắt buộc**. Đo thực tế cho thấy nó chỉ nhanh hơn `opusscript`
1,4 lần và tiết kiệm ~0,8 điểm phần trăm CPU — xem
[04-do-hieu-nang.md](04-do-hieu-nang.md).

Trên **Windows với Node 26** thì không có bản dựng sẵn lẫn trình biên dịch. Cách
xử lý đã dùng: tải thủ công bản `node-v127` rồi chép vào thư mục mà Node 26 tìm.
Hợp lệ vì đây là binary **N-API v3**, mà N-API cam kết tương thích ABI xuyên
phiên bản Node:

```
node_modules/@discordjs/opus/prebuild/node-v147-napi-v3-win32-x64-unknown-unknown/opus.node
```

File này bị xoá mỗi lần `npm install` lại.
