# Personal Brand Video AI

Ứng dụng tạo video xây dựng thương hiệu cá nhân từ một ảnh nhân vật, nội dung đầu vào và kịch bản nhiều cảnh do DeepSeek tạo.

## Pipeline video được bảo toàn

Hai route cũ không bị thay đổi:

- `app/api/generate/route.ts`
- `app/api/job/route.ts`

Mỗi cảnh vẫn gửi đúng `FormData` gồm `image`, `script`, `model`, gọi `POST /api/generate`, nhận `jobId`, sau đó polling `GET /api/job` mỗi 5 giây đến khi có `videoUrl`.

## Tính năng mới

Trang chủ `/` và đường dẫn `/kich-ban-video-chia-se` hỗ trợ:

- Video 16, 24, 32, 40 hoặc 48 giây.
- Tự quy đổi thành 2–6 cảnh, mỗi cảnh 8 giây.
- Giọng Bắc, Trung hoặc Nam.
- 8 phong cách biểu cảm.
- Tỷ lệ 9:16 hoặc 16:9.
- DeepSeek tạo kịch bản liền mạch, lời thoại và prompt cho từng cảnh.
- Chỉnh sửa hoặc viết lại riêng từng cảnh.
- Tạo cảnh tuần tự qua pipeline cũ.
- Giữ kết quả các cảnh đã hoàn thành và thử lại riêng cảnh lỗi.
- Ghép video bằng API mới `POST /api/video/merge`.
- Tự tải file `personal-brand-video-[timestamp].mp4`.

## Biến môi trường

Tạo `.env.local` khi chạy local:

```env
USEAPI_TOKEN=...
USEAPI_EMAIL=...
DEEPSEEK_API_KEY=...
# Không bắt buộc; nếu bỏ trống app dùng model mặc định hiện tại.
DEEPSEEK_MODEL=deepseek-v4-flash
```

Trên Vercel, thêm các biến tương tự trong Project → Settings → Environment Variables rồi redeploy. Không dùng tiền tố `NEXT_PUBLIC_`.

## Chạy local

```bash
npm install
npm run dev
```

Mở:

- `/` cho ứng dụng video thương hiệu cá nhân.
- `/kich-ban-video-chia-se` là đường dẫn dự phòng đến cùng giao diện mới.
- `/video-8-giay` cho công cụ tạo video 8 giây cũ.

## Ghép video

API ghép video mới sử dụng `ffmpeg-static` phía server. Route này tách biệt hoàn toàn với pipeline tạo video cũ. Khi triển khai Vercel, cần bảo đảm gói FFmpeg được cài trong dependencies và function có đủ thời gian/dung lượng xử lý các clip.
