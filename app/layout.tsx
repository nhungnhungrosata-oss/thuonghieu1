import type { Metadata } from 'next';
import SaasHeader from '../components/SaasHeader';
import './globals.css';

export const metadata: Metadata = {
  title: 'Personal Brand Video AI SaaS',
  description: 'Tạo video xây dựng thương hiệu cá nhân nhiều cảnh bằng DeepSeek và Google Flow'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Lexend:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SaasHeader />
        {children}
      </body>
    </html>
  );
}
