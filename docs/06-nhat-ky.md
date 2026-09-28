# Nhật ký thay đổi

## 25/09/2026 — Đưa bot lên máy chủ

### Bối cảnh

Bot đang chạy trên laptop, tắt máy là bot chết. Ban đầu định dùng Azure for
Students, sau chuyển sang AWS.

### Sự cố mở đầu: `DiscordAPIError[10062]`

```
Lỗi xử lý lệnh: DiscordAPIError[10062]: Unknown interaction
Không thể gửi thông báo lỗi: DiscordAPIError[10062]: Unknown interaction
```

Hai stack trace cho **cùng một sự cố**: lệnh trả lời thất bại, rồi khối `catch`
thử báo lỗi và cũng thất bại nốt.

Nguyên nhân: Discord chỉ cho **3 giây** để trả lời lần đầu. Lệnh `/filter` gọi
`await playNext()` — spawn `yt-dlp` và `ffmpeg` — **trước khi** trả lời, nên dễ
vượt quá.

Sửa ở commit **`b135a77`**:
- `/filter` gọi `deferReply()` trước khi làm việc nặng, đổi sang `editReply()`
- `catch` bỏ qua mã `10062`/`40060` thay vì thử trả lời tiếp

Đã rà lại toàn bộ 10 lệnh, tất cả đều báo nhận trước mọi `await`.

### Chọn hạ tầng

Cân nhắc Azure B1s trước. Lo ngại ban đầu là CPU không đủ vì baseline B1s chỉ
10% một vCPU.

**Đo thực tế lật ngược giả định.** Ước tính ban đầu cho rằng `opusscript` ăn
20–40% một core và encoder native sẽ nhanh hơn 5–8 lần. Đo ra: `opusscript` chỉ
tốn 2,88% một core, native nhanh hơn **1,4 lần**. Encode Opus không phải nút
thắt.

Tổng thực tế: **~5,3% một core** mỗi luồng, đo trên CPU laptop đời 2012.

Kết luận: cả B1s lẫn `t3.micro` đều thừa sức. Chọn AWS `t3.micro` Singapore.

Chi tiết số liệu: [04-do-hieu-nang.md](04-do-hieu-nang.md).

### Cài đặt

Theo đúng [02-cai-dat-tu-dau.md](02-cai-dat-tu-dau.md). Hai chỗ phát sinh:

**1. `@discordjs/opus` build lỗi trên server.** `node-pre-gyp` tìm bản dựng sẵn
cho `glibc-2.39` (Ubuntu 24.04) nhưng dự án chỉ build cho 2.31 và 2.35 → 404 →
rơi về biên dịch source → thiếu `make`. Sửa bằng `apt install build-essential`,
biên dịch mất ~40 giây.

**2. Trước đó trên Windows cũng lỗi tương tự** — không có bản dựng sẵn cho
Node 26 (ABI `node-v147`) và Visual Studio thiếu workload C++. Xử lý bằng cách
tải thủ công binary `node-v127` rồi chép vào thư mục Node 26 tìm, hợp lệ vì đây
là binary N-API v3 tương thích ABI xuyên phiên bản.

### Vấn đề YouTube chặn

Ngay sau khi lên máy chủ, `/play` báo `Sign in to confirm you're not a bot`.

Đã thử và loại trừ:
- 7 player client khác nhau → chặn sạch
- PO token provider một mình → vẫn chặn
- `yt-dlp-YTAgeGateBypass` → sai vấn đề (age gate, không phải bot check) và
  repo đang tạm ngưng hoạt động

Giải pháp: **cookies**, kèm PO token để cookies bền hơn. Chi tiết:
[03-youtube-cookies.md](03-youtube-cookies.md).

### Kết quả

```
zam-bot       active, enabled
pot-provider  active, enabled, 127.0.0.1:4416
RAM           461 / 911 MiB
```

Hai video từng bị chặn giờ lấy được bình thường.

---

## 28/09/2026 — Cookies và vá lỗ bảo mật

### Bật cookies

Export từ hồ sơ Chrome riêng với tài khoản Google phụ, đẩy lên máy chủ, bật
`YTDL_COOKIES`. Cả hai video từng bị chặn đều chạy được và lấy được luồng audio
thật.

### Vá `.gitignore`

Phát hiện lỗ: `.gitignore` chỉ chặn đúng tên `cookies.txt`, trong khi tiện ích
export ra tên theo domain — `www.youtube.com_cookies.txt`. File chứa phiên đăng
nhập Google **đang lọt lưới** và có thể bị push lên repo công khai.

Sửa ở commit **`6383347`**, đổi sang ký tự đại diện:

```
*cookies*.txt
*.pem
*.key
```

### Tạo thư mục `docs/`

Chính là thư mục bạn đang đọc.

---

## 28/09/2026 — Chuyển sang Lavalink

Bỏ đường yt-dlp → ffmpeg → opusscript trong Node, giao phần phát nhạc cho
Lavalink 4.2.2 (client Node: `shoukaku` 4). Gỡ `@discordjs/voice`,
`@discordjs/opus`, `ffmpeg-static`, `libsodium-wrappers`, `opusscript`,
`@noble/ciphers`, `@distube/ytdl-core`.

- `/filter` áp ngay lên bài đang phát, không phát lại từ đầu
- `/play` nhận thêm link SoundCloud, Bandcamp, Twitch, Vimeo
- YouTube bị chặn thì tự chuyển sang yt-dlp + cookies lấy link audio, rồi
  Lavalink phát link đó qua nguồn HTTP

Đã kiểm tra local: tìm kiếm, video, playlist 120 bài và link từ yt-dlp đều
nạp được qua Lavalink. Chi tiết: [07-lavalink.md](07-lavalink.md).
