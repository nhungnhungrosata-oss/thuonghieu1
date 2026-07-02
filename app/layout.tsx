import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Personal Brand Video AI',
  description: 'Tạo video xây dựng thương hiệu cá nhân nhiều cảnh bằng DeepSeek và Google Flow'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
