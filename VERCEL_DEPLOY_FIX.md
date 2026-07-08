# Vercel npm install fix

Bản 3.0.1 sửa lỗi triển khai do `package-lock.json` cũ chứa URL registry nội bộ không truy cập được từ Vercel.

## Đã sửa

- Toàn bộ 379 URL tải package đã chuyển sang `https://registry.npmjs.org/`.
- Thêm `.npmrc` để buộc npm dùng registry công khai.
- Bỏ script `postinstall` bị chạy trùng; `prebuild` vẫn chuẩn bị FFmpeg trước khi Next.js build.
- Không thay đổi logic API, Supabase, Stripe, DeepSeek hoặc useapi.net.

## Sau khi upload GitHub

1. Commit toàn bộ nội dung bản này, đặc biệt là `package-lock.json`, `.npmrc` và `package.json`.
2. Trong Vercel mở Deployments và chọn Redeploy.
3. Bỏ chọn `Use existing Build Cache` để triển khai sạch.
4. Không đặt Install Command tùy chỉnh. Để Vercel tự chạy npm install.

Nếu Vercel vẫn dùng cấu hình cũ, vào Project Settings > Build and Deployment > Install Command và tắt Override.
