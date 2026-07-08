# Hướng dẫn upload và triển khai thử nghiệm

## A. Upload lên GitHub

1. Tạo một branch mới, ví dụ `test/saas-v3`.
2. Giải nén file ZIP.
3. Mở thư mục `thuonghieu1-saas-merged-v3`.
4. Upload **toàn bộ nội dung bên trong thư mục**, không upload thêm một lớp thư mục ngoài.
5. Không upload `node_modules`, `.next`, `.ffmpeg`, `.env.local` hoặc secret thật.
6. Commit lên branch thử nghiệm, chưa merge vào `main`.

## B. Cấu hình Supabase

1. Tạo project Supabase.
2. Chạy `supabase/migrations/001_complete_saas.sql` trong SQL Editor.
3. Bật Email/Password trong Authentication.
4. Thêm Site URL và redirect `/auth/confirm`.
5. Lấy URL, anon key và service role key cho Vercel.
6. Không đưa service role key vào mã nguồn hoặc biến `NEXT_PUBLIC_*`.

## C. Cấu hình Vercel

Nhập đầy đủ các biến trong `.env.example`. Với lần thử đầu tiên:

- Dùng Stripe test key `sk_test_...`.
- Dùng Stripe test webhook signing secret.
- Đặt `APP_URL` đúng domain preview hoặc domain test ổn định.
- Đặt một `CRON_SECRET` dài và ngẫu nhiên.
- Để `USEAPI_EMAIL` rỗng khi muốn useapi.net cân bằng nhiều tài khoản Flow.

Sau khi thêm biến, redeploy và bỏ dùng Build Cache ở lần đầu.

## D. Checklist thử nghiệm bắt buộc

### Đăng nhập

- Đăng ký tài khoản A và xác nhận email.
- Đăng ký tài khoản B.
- Đăng xuất/đăng nhập lại thành công.
- Cookie đăng nhập không xuất hiện trong localStorage.

### Cô lập dữ liệu

- Tài khoản A tạo một cảnh và lấy `jobId`.
- Tài khoản B không polling được `jobId` hoặc tải video của A.
- A không mở được output của B.

### Credit

- Tạo một cảnh làm giảm đúng 1 credit.
- Provider lỗi làm hoàn lại đúng 1 credit.
- Refresh hoặc bấm lặp không tạo trừ credit trùng trong cửa sổ idempotency.
- Job treo được cron xử lý và hoàn credit.

### Video

- Tạo video 16, 24, 32, 40 và 48 giây.
- Kiểm tra đúng giọng vùng miền đã chọn.
- Kiểm tra nhân vật, bối cảnh, sản phẩm và giọng không đổi giữa các cảnh.
- Ghép video theo đúng thứ tự.
- Video hoàn chỉnh xuất hiện trong `/account` và tải lại được.
- Video của provider hết hạn nhưng bản Supabase Storage vẫn tải được.

### Stripe test mode

- Thanh toán test thành công cộng đúng credit.
- Refresh trang success không cộng lần hai.
- Event webhook gửi lại không cộng lần hai.
- Checkout hết hạn chuyển đơn sang `expired`.
- Hoàn tiền toàn phần hoặc một phần thu hồi credit đúng logic.

### Vận hành

- Gọi cron với sai secret trả 401.
- Gọi cron đúng secret trả JSON summary.
- Kiểm tra log lỗi 429, captcha và quota của useapi.net.
- Theo dõi dung lượng Supabase Storage và thời gian function ghép FFmpeg.

Chỉ merge vào `main` sau khi toàn bộ checklist trên đạt trên môi trường thử nghiệm.
