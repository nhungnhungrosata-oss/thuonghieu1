'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './SaasHeader.module.css';

export default function SaasHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (pathname === '/login') return null;

  async function logout() {
    setLoading(true);
    await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' })
    }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className={styles.header}>
      <a href="/" className={styles.brand}>
        <span>AI</span>
        Personal Brand Video
      </a>
      <nav>
        <a className={pathname === '/' || pathname === '/kich-ban-video-chia-se' ? styles.active : ''} href="/">
          Tạo video
        </a>
        <a className={pathname === '/account' ? styles.active : ''} href="/account">
          Tài khoản
        </a>
        <button type="button" onClick={logout} disabled={loading}>
          {loading ? 'Đang thoát...' : 'Đăng xuất'}
        </button>
      </nav>
    </header>
  );
}
