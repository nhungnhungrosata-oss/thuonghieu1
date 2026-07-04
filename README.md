# Personal Brand Video AI SaaS

Ứng dụng tạo video xây dựng thương hiệu cá nhân từ ảnh nhân vật, nội dung đầu vào và kịch bản nhiều cảnh do DeepSeek tạo. Bản này bổ sung nền tảng nhiều người dùng để có thể mở bán SaaS công khai.

## Pipeline video được bảo toàn

Frontend vẫn sử dụng đúng luồng cũ:

1. Gửi từng cảnh đến `POST /api/generate` bằng `FormData` gồm `image`, `script`, `model`.
2. Nhận `jobId`.
3. Polling `GET /api/job?jobId=...` mỗi 5 giây.
4. Ghép các cảnh bằng `POST /api/video/merge`.

Hai endpoint cũ vẫn giữ nguyên URL và kiểu phản hồi cần thiết cho giao diện hiện tại. Phần SaaS được chèn ở backend để kiểm soát user, credit, giới hạn đồng thời và quyền sở hữu job.

## Tính năng SaaS đã thêm

- Đăng ký và đăng nhập bằng Supabase Auth.
- Session lưu trong cookie `HttpOnly`, không lưu token đăng nhập vào localStorage.
- Mỗi `jobId` được gắn với đúng tài khoản tạo ra nó.
- Người dùng không thể đọc trạng thái job của tài khoản khác.
- Credit được trừ nguyên tử trước khi gửi job.
- Credit tự hoàn khi upload hoặc tạo video thất bại.
- Chống bấm tạo trùng trong cửa sổ 15 phút bằng idempotency hash.
- Giới hạn số cảnh đồng thời theo từng gói.
- Giới hạn số cảnh theo giờ và giới hạn riêng cho API viết kịch bản/ghép video.
- Giới hạn tải đồng thời toàn hệ thống.
- Trang `/account` hiển thị credit, gói, giới hạn và 20 lượt tạo gần nhất.
- API token Google Flow, DeepSeek và Supabase service role chỉ tồn tại ở backend.

## Cấu hình Supabase

1. Tạo một project Supabase.
2. Mở **SQL Editor**.
3. Chạy hai file dưới đây theo đúng thứ tự:

```text
supabase/migrations/20260704_saas_foundation.sql
supabase/migrations/20260704_api_quota.sql
```

Các migration tạo:

- `profiles`: gói, credit và giới hạn của từng user.
- `generations`: lịch sử, trạng thái và quyền sở hữu job.
- `saas_settings`: giới hạn đồng thời toàn hệ thống.
- `api_usage_events`: giới hạn các API có chi phí cao.
- RPC `reserve_video_generation`: giữ slot và trừ credit nguyên tử.
- RPC `fail_and_refund_generation`: đánh dấu lỗi và hoàn credit đúng một lần.
- RPC `consume_api_quota`: rate limit theo user và loại thao tác.
- Row Level Security để user chỉ đọc dữ liệu của chính mình.

Trong Supabase Auth, bật Email/Password. Có thể bật xác nhận email; trang `/auth/confirm` nhận token xác nhận từ trình duyệt và đổi sang cookie `HttpOnly`.

## Biến môi trường

Tạo `.env.local` khi chạy local hoặc thêm vào Vercel:

```env
USEAPI_TOKEN=user:YOUR_USEAPI_TOKEN_HERE

# Để trống khi dùng nhiều tài khoản Flow và muốn useapi.net tự cân bằng tải.
USEAPI_EMAIL=

DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_MODEL=deepseek-v4-flash

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Không dùng tiền tố `NEXT_PUBLIC_` cho các khóa trên. Tuyệt đối không commit giá trị thật vào GitHub.

## Nhiều tài khoản Google Flow

Để phục vụ nhiều khách hàng cùng lúc:

1. Thêm nhiều tài khoản Google Flow trong useapi.net.
2. Không đặt `USEAPI_EMAIL`, hoặc để biến này rỗng.
3. useapi.net sẽ tự chọn tài khoản đủ điều kiện và cân bằng tải.
4. Theo dõi quota, captcha và lỗi `429` trong dashboard useapi.net.

Nếu đặt `USEAPI_EMAIL`, toàn bộ khách hàng vẫn bị ép chạy qua một tài khoản Flow duy nhất.

## Credit và gói dịch vụ

Mặc định một tài khoản mới nhận:

- Gói `trial`.
- 12 credit.
- Tối đa 12 cảnh mỗi giờ.
- Tối đa 2 cảnh đang xử lý đồng thời.

Mỗi cảnh 8 giây dùng 1 credit. Video 24 giây gồm 3 cảnh nên dùng 3 credit.

Có thể nâng gói thủ công trong Supabase:

```sql
update public.profiles
set plan = 'pro', credits = credits + 100, hourly_scene_limit = 60, max_active_scenes = 4
where email = 'khachhang@example.com';
```

Các gói hợp lệ hiện tại: `trial`, `starter`, `pro`, `business`.

> Hệ thống credit đã sẵn sàng để nối Stripe hoặc cổng thanh toán Việt Nam. Nhánh này chưa tự động thu tiền hoặc xử lý webhook thanh toán.

## Giới hạn đồng thời toàn hệ thống

Mặc định tối đa 40 cảnh ở trạng thái `reserved`, `submitted` hoặc `processing` trong toàn hệ thống.

Thay đổi bằng SQL:

```sql
update public.saas_settings
set global_active_limit = 80
where singleton = true;
```

Chỉ tăng giới hạn sau khi đã bổ sung đủ tài khoản Google Flow và kiểm tra quota thực tế.

## Chạy local

```bash
npm install
npm run dev
```

Mở:

- `/login`: đăng ký hoặc đăng nhập.
- `/`: công cụ tạo video thương hiệu cá nhân.
- `/account`: credit và lịch sử tạo video.
- `/video-8-giay`: công cụ video 8 giây cũ, cũng được bảo vệ đăng nhập.

## Ghép video

API ghép video sử dụng `ffmpeg-static` phía server. Các lifecycle script `postinstall` và `prebuild` sao chép binary vào `.ffmpeg/ffmpeg`; `outputFileTracingIncludes` trong `next.config.mjs` buộc Vercel đưa binary này vào API `/api/video/merge`.

Khi redeploy trên Vercel và gặp `spawn ... ffmpeg ENOENT`, chọn Redeploy và bỏ chọn dùng lại Build Cache.

## Việc còn phải làm trước khi thu tiền thật

- Tích hợp cổng thanh toán và webhook cộng credit theo giao dịch đã xác minh.
- Tải video hoàn thành về S3, Cloudflare R2 hoặc Supabase Storage. Hiện lịch sử đang lưu URL kết quả của provider; URL này không nên được coi là kho lưu trữ lâu dài.
- Có cron hoặc worker xử lý các reservation bị treo lâu bất thường và cảnh báo vận hành.
- Thiết lập điều khoản sử dụng, chính sách riêng tư, hỗ trợ hoàn tiền và kiểm duyệt nội dung.

## Kiểm tra trước khi mở bán

- Chạy đủ hai migration Supabase thành công.
- Đăng ký được hai tài khoản khác nhau.
- Tài khoản A không thể polling `jobId` của tài khoản B.
- Credit giảm đúng số cảnh và được hoàn khi provider trả lỗi.
- Rate limit hoạt động với DeepSeek và API ghép video.
- Không có khóa bí mật nào dùng tiền tố `NEXT_PUBLIC_`.
- Đã thêm nhiều tài khoản Flow nếu dự kiến nhiều job đồng thời.
- Đã cấu hình captcha provider dự phòng.
- Đã cấu hình lưu trữ video dài hạn trước khi bán gói trả phí.
- Đã thiết lập điều khoản sử dụng, chính sách riêng tư và quy trình hỗ trợ khách hàng.
