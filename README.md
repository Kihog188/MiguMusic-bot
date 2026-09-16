# Bot Discord Nghe Nhạc YouTube

Bot Discord đơn giản cho phép phát nhạc từ link YouTube (hoặc tìm theo từ khoá) trong kênh thoại, có hàng đợi (queue), skip, pause/resume.

## 1. Chuẩn bị

- Cài [Node.js](https://nodejs.org/) bản 18 trở lên.
- Có một **bot Discord** đã tạo tại [Discord Developer Portal](https://discord.com/developers/applications):
  1. Vào **New Application** → đặt tên.
  2. Vào tab **Bot** → **Add Bot** → copy **Token** (giữ bí mật, không share cho ai!).
  3. Trong tab **Bot**, bật các **Privileged Gateway Intents** cần thiết (thường không cần intent đặc biệt cho bot nhạc, nhưng bật **Server Members Intent** nếu sau này cần).
  4. Vào tab **OAuth2 → URL Generator**:
     - Scopes: chọn `bot` và `applications.commands`
     - Bot Permissions: chọn `Connect`, `Speak`, `Send Messages`, `Embed Links`, `Use Slash Commands`
     - Copy link tạo ra và mở trong trình duyệt để mời bot vào server của bạn.
  5. Copy **Application ID** (Client ID) ở tab **General Information**.

## 2. Cài đặt code

```bash
cd discord-music-bot
npm install
```

Tạo file `.env` (copy từ `.env.example`) và điền thông tin:

```
DISCORD_TOKEN=token_bot_cua_ban
CLIENT_ID=application_id_cua_ban
GUILD_ID=id_server_de_test  # không bắt buộc, nhưng nên có lúc test cho cập nhật lệnh nhanh
```

> Cách lấy GUILD_ID: bật Developer Mode trong Discord (Cài đặt → Advanced), chuột phải vào server → Copy Server ID.

## 3. Đăng ký lệnh (slash commands)

```bash
node deploy-commands.js
```

Chạy lại lệnh này mỗi khi bạn thêm/sửa lệnh trong `deploy-commands.js`.

## 4. Chạy bot

```bash
npm start
```

Nếu thấy dòng `Đã đăng nhập với tên ...` là bot đã online.

## 5. Cách dùng trong Discord

- `/play link:<link YouTube hoặc từ khoá>` — phát nhạc (vào kênh thoại trước khi gõ lệnh)
- `/skip` — bỏ qua bài hiện tại
- `/pause` / `/resume` — tạm dừng / tiếp tục
- `/queue` — xem hàng đợi
- `/nowplaying` — xem bài đang phát
- `/stop` — dừng và xoá hết hàng đợi, bot rời kênh
- `/leave` — bot rời kênh thoại

## Ghi chú quan trọng

- Bot dùng thư viện `@distube/ytdl-core` để lấy audio trực tiếp từ YouTube. Vì YouTube liên tục thay đổi cơ chế chống bot, đôi khi thư viện có thể bị lỗi tạm thời — nếu gặp lỗi `Status code: 410` hoặc tương tự, thử chạy `npm update @distube/ytdl-core` để lấy bản vá mới nhất.
- Việc tải/stream nội dung từ YouTube cho mục đích ngoài phạm vi cá nhân có thể vi phạm Điều khoản dịch vụ của YouTube — bạn tự chịu trách nhiệm khi triển khai bot cho server công khai hoặc quy mô lớn.
- Để chạy bot 24/7, bạn cần host nó trên một máy chủ luôn bật (VPS, Raspberry Pi, hoặc dịch vụ hosting bot Discord).
- Nếu server chặn UDP (một số VPS giá rẻ), bot có thể vào được kênh thoại nhưng không phát được âm thanh — cần VPS hỗ trợ UDP outbound.
"# MiguMusic-bot" 
