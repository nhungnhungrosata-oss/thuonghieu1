# Vercel Auth Fix v3.0.2

Bản sửa gồm:

- Xóa `outputFileTracingExcludes` từng loại toàn bộ `node_modules` khỏi Vercel Functions.
- Giữ đóng gói riêng `.ffmpeg/ffmpeg` cho route ghép video.
- Trang đăng nhập/đăng ký không còn cố parse HTML thành JSON; khi function lỗi sẽ hiện thông báo dễ hiểu.

Sau khi upload lên GitHub:

1. Vào Vercel > Deployments.
2. Redeploy deployment mới nhất.
3. Bỏ chọn Use existing Build Cache.
4. Thử đăng ký lại.
