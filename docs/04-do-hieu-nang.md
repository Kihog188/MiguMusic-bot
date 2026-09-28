# Số liệu đo thực tế

Đo ngày 25/09/2026. Dùng để quyết định có cần nâng cấp máy hay không, thay vì
đoán mò.

## Điều kiện đo

Toàn bộ số CPU đo trên **Intel i5-3360M** — CPU laptop Ivy Bridge đời **2012**,
2 nhân 4 luồng. Đây là phần cứng **yếu hơn hoặc ngang** vCPU của `t3.micro`
(thường là Xeon Cascade Lake 2,6 GHz), nên các con số dưới đây là **ước lượng
thận trọng**. Chạy trên AWS nhiều khả năng còn thấp hơn.

Bài test: một video 213 giây.

## CPU cho một luồng nhạc

| Khâu | CPU giây / bài 213s | % một core |
|---|---|---|
| `yt-dlp` tải + giải n-challenge | 3,67 | 1,72% *(dồn vào ~9s đầu bài)* |
| `ffmpeg` decode → PCM 48k stereo | 2,06 | 0,97% |
| `ffmpeg` + filter (bassboost/nightcore) | 2,02 – 2,19 | 0,95 – 1,03% |
| Node: opus encode + xử lý stream | 5,42 | 2,55% |
| **Tổng** | **~11,2 giây** | **~5,3% một core** |

**Chưa đo:** heartbeat gateway của discord.js và mã hoá `aes-256-gcm` từng gói
UDP voice. Cả hai đều nhỏ, ước chừng dưới 1%.

Quan sát thêm từ log systemd: bot chạy không tải ~11 phút chỉ tiêu thụ 4,0 giây
CPU và 64,8 MB RAM đỉnh. Lúc rảnh gần như không tốn gì.

## Ngân sách CPU theo instance type

Credit của AWS: 1 credit = 1 vCPU chạy 100% trong 1 phút.

| Instance | RAM | Credit/giờ | Ngân sách liên tục | Stream đồng thời |
|---|---|---|---|---|
| `t3.micro` | 1 GB | 12 | 20% một core | **~3** |
| `t3.small` | 2 GB | 24 | 40% một core | ~7 |
| `t3.medium` | 4 GB | 24 | 40% một core | ~7 |

`t3.medium` vô nghĩa — cùng credit với `small`, chỉ hơn RAM mà RAM không phải
nút thắt.

Số server Discord bot tham gia **không quan trọng**. Server không phát nhạc thì
gần như không tốn gì. Chỉ số **luồng phát đồng thời** mới quyết định.

## RAM

| Thành phần | Đo được |
|---|---|
| `yt-dlp` trên Windows (2 tiến trình PyInstaller) | **103 MB đỉnh** |
| Node + opus encoder (script tối giản) | 51,7 MB |
| Bot đầy đủ lúc chạy (systemd báo) | ~65–120 MB đỉnh |

> Trên Linux, `yt-dlp` là **zipapp Python** dùng `python3` hệ thống, không phải
> file PyInstaller như `yt-dlp.exe` trên Windows. Không có bước bung file nên
> khởi động nhanh hơn và tốn ít RAM hơn con số 103 MB đo trên Windows.

**Rủi ro chính:** mỗi lượt `/play` sinh một `yt-dlp`. Vài người spam `/play`
cùng lúc là có mấy tiến trình song song → hết RAM → kernel giết Node → bot chết.
Vì vậy swap 2 GB là bắt buộc.

## Băng thông

Bitrate Opus đo được: **98,9 kbps** → ~44,5 MB/giờ mỗi luồng.

| Luồng chạy 24/7 | Egress/tháng | Vượt 100 GB miễn phí? |
|---|---|---|
| 1 | ~32 GB | Không |
| 3 | ~96 GB | Sát mép |
| 7 | ~224 GB | Vượt 124 GB → **~15 USD/tháng** |

AWS Singapore tính ~0,12 USD/GB sau mức miễn phí. Khi lên 5–7 luồng đồng thời,
**tiền băng thông bắt đầu ngang ngửa tiền máy** — mà nâng cấp máy không giải
quyết được khoản đó.

Chiều vào (YouTube → máy chủ) thì AWS miễn phí, không cần lo.

## `@discordjs/opus` so với `opusscript`

Encode 60 giây audio:

| Encoder | Thời gian | CPU cho 1 luồng |
|---|---|---|
| `@discordjs/opus` (native) | 1234 ms | **2,06%** một core |
| `opusscript` (WASM) | 1730 ms | **2,88%** một core |

Chỉ nhanh hơn **1,4 lần**. Lý do: `opusscript` là libopus biên dịch sang WASM,
mà WASM đời mới chạy gần bằng native.

**Kết luận: encode Opus không phải nút thắt.** Tổng CPU mỗi luồng là ~5,3% với
native và ~6,1% với `opusscript` — cả hai đều lọt thoải mái dưới baseline 20%
của `t3.micro`. Gói này là "có thì tốt", không bắt buộc.

Chất lượng âm thanh **không khác nhau**: cả hai đều là libopus, chỉ khác cách
biên dịch. Đổi encoder không gây nhiễu, không làm nhạc phát nhanh hay chậm —
tốc độ phát do sample rate (ffmpeg ép cứng 48000/2ch) và nhịp 20 ms do
`@discordjs/voice` tự đếm quyết định.

## Khi nào cần nâng cấp

Đổi instance type chỉ mất 2 phút và **không mất dữ liệu**:

```
Stop instance → Actions → Instance settings → Change instance type → Start
```

Chỉ mất IP public (stop/start cấp IP mới), không ảnh hưởng bot.

Dấu hiệu cần nâng:

```bash
free -h                                      # swap bi dung nhieu = thieu RAM
journalctl -u zam-bot | grep -i "oom\|killed"
```

Cộng thêm chỉ số **`CPUCreditBalance`** trên CloudWatch — nếu tụt dần về 0 là
đang vượt baseline liên tục.
