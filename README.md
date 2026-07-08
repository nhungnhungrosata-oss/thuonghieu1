# Personal Brand Video AI SaaS — bản hợp nhất đầy đủ

Bản này được hợp nhất trực tiếp từ mã nguồn GitHub cũ, vì vậy **không làm mất các trang và component đang hoạt động**. Toàn bộ studio tạo video nhiều cảnh, công cụ video 8 giây, DeepSeek, Google Flow/useapi.net và FFmpeg vẫn được giữ lại; lớp SaaS được bổ sung ở backend.

## Những phần đã được giữ nguyên từ bản GitHub

- `/` và `/kich-ban-video-chia-se`: studio tạo video 16–48 giây.
- `/video-8-giay`: công cụ tạo một cảnh 8 giây.
- Bộ component `components/video-share-script/*`.
- Logic tạo kịch bản, chỉnh sửa từng cảnh và giữ giọng vùng miền.
- Luồng `POST /api/generate` → polling `GET /api/job` → `POST /api/video/merge`.
- FormData cũ vẫn dùng các trường `image`, `script`, `model`; chỉ bổ sung `aspectRatio` và dữ liệu theo dõi an toàn.

## Tính năng SaaS được bổ sung

- Supabase Auth: đăng ký, đăng nhập, xác nhận email và cookie `HttpOnly`.
- Cô lập dữ liệu theo user; không thể polling hoặc tải video của tài khoản khác.
- Credit được trừ nguyên tử trước khi tạo cảnh và hoàn đúng một lần khi job thất bại.
- Giới hạn cảnh theo giờ, cảnh đồng thời của từng gói và tải đồng thời toàn hệ thống.
- Stripe Checkout, webhook có kiểm tra chữ ký, chống xử lý sự kiện trùng và xử lý hoàn tiền.
- Lưu cảnh và video hoàn chỉnh vào Supabase Storage riêng tư.
- Cron đối soát job treo, archive video và xóa video hết hạn.
- Mã khôi phục job có chữ ký HMAC khi provider đã nhận job nhưng database ghi chậm.
- Chỉ ghép các `generationId` thuộc đúng tài khoản đang đăng nhập.
- Model mặc định: `veo-3.1-lite-low-priority`.
- Tên hiển thị chính xác: `Veo 3.1 - lite [Lower Priority]`.

## Cấu trúc route

### Trang

- `/login`
- `/auth/confirm`
- `/`
- `/kich-ban-video-chia-se`
- `/video-8-giay`
- `/account`

### API

- `/api/auth/session`
- `/api/account`
- `/api/deepseek/script`
- `/api/generate`
- `/api/job`
- `/api/video/merge`
- `/api/videos/[generationId]/download`
- `/api/outputs/[outputId]/download`
- `/api/billing/catalog`
- `/api/billing/checkout`
- `/api/billing/webhook`
- `/api/cron/reconcile-generations`

## Cài đặt

### 1. Supabase

Tạo project Supabase, mở **SQL Editor** và chạy toàn bộ file:

```text
supabase/migrations/001_complete_saas.sql
```

Trong **Authentication → URL Configuration**:

- Site URL: domain Vercel chính thức.
- Redirect URL: `https://TEN-MIEN-CUA-BAN.com/auth/confirm`.
- Bật Email/Password.

Migration tạo các bảng `profiles`, `generations`, `video_outputs`, `payment_orders`, `payment_events`, `api_usage_events`, bucket riêng tư `generated-videos`, Row Level Security và các RPC nguyên tử.

### 2. Biến môi trường

Sao chép `.env.example` thành `.env.local` khi chạy local. Trên Vercel, nhập các biến vào **Project → Settings → Environment Variables**:

```env
USEAPI_TOKEN=
USEAPI_EMAIL=
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
APP_URL=https://TEN-MIEN-CUA-BAN.com
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VIDEO_STORAGE_BUCKET=generated-videos
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CURRENCY=usd
STRIPE_STARTER_AMOUNT=990
STRIPE_PRO_AMOUNT=2490
STRIPE_BUSINESS_AMOUNT=5990
CRON_SECRET=
VIDEO_SOURCE_HOSTS=.googleusercontent.com,.googlevideo.com,.useapi.net,.supabase.co,storage.googleapis.com
```

Không dùng tiền tố `NEXT_PUBLIC_` cho token hoặc secret.

Để useapi.net tự cân bằng nhiều tài khoản Google Flow, giữ `USEAPI_EMAIL` rỗng.

### 3. Stripe

Tạo webhook trỏ đến:

```text
https://TEN-MIEN-CUA-BAN.com/api/billing/webhook
```

Đăng ký các event:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`

Dán signing secret vào `STRIPE_WEBHOOK_SECRET`.

### 4. Cron

`vercel.json` dùng lịch một lần mỗi ngày để tương thích Vercel Hobby. Khi bán SaaS thật, nên dùng Vercel Pro hoặc dịch vụ cron ngoài gọi mỗi 5–10 phút:

```http
GET /api/cron/reconcile-generations
Authorization: Bearer <CRON_SECRET>
```

### 5. Chạy local

```bash
npm ci
npm run dev
```

Kiểm tra production:

```bash
npm run typecheck
npm run build
npm start
```

## FFmpeg

`postinstall` và `prebuild` sao chép binary từ `ffmpeg-static` sang `.ffmpeg/ffmpeg`. `next.config.mjs` đưa đúng binary này vào function `/api/video/merge`.

Nếu Vercel báo `ffmpeg ENOENT`, redeploy và bỏ chọn dùng lại Build Cache. Việc ghép video 32–48 giây ở độ phân giải cao nên chạy trên gói có thời gian function và RAM phù hợp.

## Kiểm tra đã thực hiện

Xem `VALIDATION_REPORT.md`. Tóm tắt:

- Bảo toàn toàn bộ 26 tệp nguồn của ZIP GitHub người dùng cung cấp.
- Bổ sung 32 tệp SaaS/tài liệu.
- TypeScript đạt.
- Next.js production build đạt.
- FFmpeg xuất hiện trong output trace của route ghép video.
- Production server khởi động và các route bảo vệ trả đúng trạng thái.
- `npm audit --omit=dev`: 0 lỗ hổng tại thời điểm đóng gói.

## Giới hạn kiểm tra

Build và kiểm tra bảo mật tĩnh đã hoàn thành. Các giao dịch Stripe thật, Supabase project thật, tài khoản useapi.net/Google Flow thật và DeepSeek thật **chưa thể chạy end-to-end khi không có secret của chủ dự án**. Hãy triển khai lên branch thử nghiệm và thực hiện checklist trong `UPLOAD_GUIDE.md` trước khi mở bán.
