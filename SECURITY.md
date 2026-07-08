# Security notes

## Bí mật

Các biến sau chỉ tồn tại ở backend:

- `USEAPI_TOKEN`
- `DEEPSEEK_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CRON_SECRET`

Không commit `.env.local`, không dùng tiền tố `NEXT_PUBLIC_` và không gửi service role key xuống trình duyệt.

## Xác thực và phân quyền

- Supabase access/refresh token được lưu bằng cookie `HttpOnly`.
- Mỗi API có chi phí xác minh access token lại với Supabase.
- Mọi truy vấn generation/output đều lọc cả `user_id` và record ID.
- Row Level Security cho phép user chỉ đọc dữ liệu của chính mình.
- Service role chỉ được dùng ở server.

## Chống lạm dụng

- Credit và slot được giữ trong RPC có khóa transaction.
- Rate limit theo user cho DeepSeek, checkout và ghép video.
- Giới hạn cảnh đồng thời theo user và toàn hệ thống.
- Idempotency cho tạo video và thanh toán.
- Mã cứu job provider có HMAC, user khác không thể tự gắn job lạ vào generation.
- Merge chỉ nhận `generationId` đã hoàn thành và thuộc đúng user.

## Thanh toán

- Stripe webhook kiểm tra chữ ký HMAC và cửa sổ thời gian.
- Event ID được lưu để chống xử lý trùng.
- Số tiền và currency được đối chiếu với đơn trong database.
- Hoàn tiền dùng số tiền hoàn tích lũy và theo dõi `credit_debt` khi user đã sử dụng credit.

## Video từ xa

- Chỉ tải HTTPS.
- Không cho phép địa chỉ IP.
- Mỗi redirect được kiểm tra lại domain.
- Chỉ chấp nhận domain trong `VIDEO_SOURCE_HOSTS`.
- Có giới hạn kích thước và thời gian tải.

## Lưu trữ

- Bucket video là private.
- Download luôn xác minh user sở hữu record.
- Cron xóa file theo thời gian lưu của gói.

## Việc chủ dự án vẫn phải thực hiện

- Dùng Stripe test mode trước khi bật live mode.
- Luân chuyển secret nếu từng bị lộ.
- Bật MFA cho GitHub, Vercel, Supabase, Stripe và useapi.net.
- Thiết lập cảnh báo chi phí, quota và lỗi webhook.
- Kiểm tra điều khoản sử dụng, riêng tư, hoàn tiền và kiểm duyệt nội dung.
