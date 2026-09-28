# YouTube chặn và cách nuôi cookies

## Vấn đề

Khi chạy trên máy chủ, `yt-dlp` sẽ gặp lỗi:

```
ERROR: [youtube] <id>: Sign in to confirm you're not a bot.
Use --cookies-from-browser or --cookies for the authentication.
```

**Đây không phải lỗi cấu hình và không phải lỗi của AWS.** YouTube đánh dấu dải
IP của trung tâm dữ liệu. Azure, VPS Việt Nam, hay bất kỳ nhà cung cấp cloud nào
đều bị đối xử như nhau. Chuyển nhà cung cấp không giải quyết được gì.

Bot chạy ngon trên laptop chính vì laptop dùng IP nhà mạng — YouTube hầu như
không thách thức IP dân cư, vì chặn nhầm là chặn người dùng thật.

## Những cách đã thử và kết quả

| Cách | Kết quả |
|---|---|
| Đổi player client (`android_vr`, `tv`, `tv_simply`, `web_safari`, `ios`, `mweb`) | ❌ chặn sạch cả 7 |
| PO token provider (bgutil) một mình | ❌ vẫn chặn |
| **Cookies** | ✅ **chạy được** |
| Cookies + PO token | ✅ khuyến nghị — cookies bền hơn |

Lưu ý: chặn theo **từng video**, không phải chặn cả IP. Một số video vẫn lấy
được bình thường. Nhưng video nhạc chính chủ từ các hãng đĩa bị siết rất gắt,
mà đó chính là thứ bot này hay phát.

### Không dùng `yt-dlp-YTAgeGateBypass`

Repo `pukkandan/yt-dlp-YTAgeGateBypass` trông có vẻ liên quan nhưng **không
dùng được**, vì hai lý do:

1. **Sai vấn đề.** Nó vượt *age gate* — rào giới hạn độ tuổi, thông báo là
   "Sign in to confirm your **age**". Lỗi ở đây là "Sign in to confirm you're
   not a **bot**", hai hệ thống khác nhau.
2. **Đang hỏng.** README có cảnh báo: *"This project is currently suspended due
   to the account proxy being down."*

Tác giả rất uy tín (lead maintainer của yt-dlp), nhưng công cụ thì không hợp.

## Cách lấy cookies

### 1. Chuẩn bị tài khoản

Dùng **tài khoản Google phụ**. Cookies cho phép truy cập tài khoản — đừng dùng
tài khoản chính. Tài khoản này cũng có thể bị Google khoá nếu bị coi là lạm dụng.

### 2. Tạo hồ sơ Chrome riêng

Chrome → ảnh đại diện góc trên phải → **Thêm** → tạo hồ sơ mới, đặt tên `bot`.

> Không dùng chế độ ẩn danh: Chrome **không cho cài tiện ích** khi đang ẩn danh.
> Nếu vẫn muốn dùng ẩn danh thì phải vào `chrome://extensions` → Chi tiết →
> bật **Cho phép ở chế độ ẩn danh** từ một cửa sổ bình thường trước.

### 3. Cài tiện ích và export

Trong hồ sơ mới, cài **Get cookies.txt LOCALLY** (mã nguồn mở, đọc cookies ngay
trên máy, không gửi đi đâu).

Đăng nhập YouTube bằng tài khoản phụ → mở một video bất kỳ cho chắc → bấm tiện
ích → **Export** → lưu vào `D:\BOT\BOT\`.

Tiện ích đặt tên file theo domain, ví dụ `www.youtube.com_cookies.txt`.

### 4. Đóng cửa sổ, TUYỆT ĐỐI KHÔNG đăng xuất

Đăng xuất khiến Google huỷ phiên ở phía máy chủ, file cookies vừa lưu thành vô
dụng **ngay lập tức**. Đây là lỗi phổ biến nhất khiến người ta làm mãi không được.

Đóng thẳng cửa sổ và không mở lại hồ sơ đó nữa.

### 5. Đẩy lên máy chủ

```powershell
scp -i D:\BOT\BOT\zam-bot-key.pem D:\BOT\BOT\www.youtube.com_cookies.txt ubuntu@<IP>:/home/ubuntu/bot/cookies.txt
```

```bash
chmod 600 ~/bot/cookies.txt
grep -q YTDL_COOKIES ~/bot/.env || echo 'YTDL_COOKIES=/home/ubuntu/bot/cookies.txt' >> ~/bot/.env
sudo systemctl restart zam-bot
```

Lần đầu cần khởi động lại để nạp biến `.env`. Những lần thay cookies sau thì
**không cần** — `yt-dlp` sinh tiến trình mới và đọc lại file ở mỗi lần gọi.

Code đọc biến này ở `index.js`, mục `YTDLP_BASE`.

### 6. Kiểm tra

```bash
YT=~/bot/node_modules/youtube-dl-exec/bin/yt-dlp
$YT --no-warnings --js-runtimes node --cookies ~/bot/cookies.txt \
    --skip-download --print '%(title)s' '<link video tung bi chan>'
```

Ra tiêu đề là được.

## Vì sao phải tách biệt hồ sơ

Không phải để giấu giếm. Nếu export từ hồ sơ Chrome hằng ngày, mỗi lần bạn tiếp
tục lướt YouTube là Google xoay vòng token phiên — bản cookies đã đẩy lên máy chủ
trở thành lỗi thời rất nhanh.

Tách riêng rồi để yên thì chỉ còn máy chủ dùng phiên đó, nên sống lâu hơn nhiều.

## Cookies sống được bao lâu

Vài tuần đến vài tháng. Hai thứ giúp kéo dài, cả hai đều đã bật sẵn:

- **`yt-dlp` tự ghi token mới vào file** sau mỗi lần chạy. Vì vậy file phải cho
  phép ghi — `chmod 600` là đúng (chủ sở hữu đọc và ghi được).
- **PO token provider** làm lưu lượng trông chính danh hơn nên ít bị thách thức.

Dấu hiệu cookies chết: log lại hiện `Sign in to confirm`. Lúc đó lặp lại từ
bước 1 với tài khoản phụ đó (hoặc tài khoản phụ khác).

## Có tự động hoá được không

**Phần làm mới thì có**, phần đăng nhập thì không.

Có thể viết script chạy theo lịch trên laptop:
`yt-dlp --cookies-from-browser firefox --cookies cookies.txt` rồi `scp` lên máy chủ.

Lưu ý: trên Windows, **Chrome và Edge từ phiên bản 127 mã hoá cookies bằng
App-Bound Encryption** nên công cụ ngoài không đọc được. Phải dùng **Firefox**.

Nhưng có bẫy: nếu cả laptop lẫn máy chủ cùng dùng chung một phiên, cả hai cùng
xoay vòng một token và có thể vô hiệu hoá lẫn nhau, khiến cookies chết **nhanh
hơn** so với không tự động hoá gì. Chỉ nên thêm khi đã thấy cookies chết thường
xuyên.

**Tuyệt đối không** dùng Playwright/Puppeteer để tự đăng nhập Google. Google phát
hiện trình duyệt tự động rất tốt: CAPTCHA, chặn xác minh 2 bước, và tài khoản dễ
bị khoá.

## Hướng thoát vĩnh viễn

Vấn đề này cố hữu với mọi hạ tầng cloud. Chỉ có một cách hết hẳn: **chạy bot
trên máy đặt tại nhà** — mini PC, Raspberry Pi, PC cũ. IP dân cư gần như không
bị thách thức, và không bao giờ phải đụng tới cookies nữa.

Đánh đổi: phụ thuộc điện và mạng nhà. Nhưng với bot dùng riêng cho vài server
bạn bè thì thường là lựa chọn hợp lý hơn cloud.
