'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

type SessionResponse = {
  ok?: boolean;
  message?: string;
};

export default function ConfirmEmailPage() {
  const [status, setStatus] = useState('Đang xác nhận tài khoản...');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    async function confirm() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const query = new URLSearchParams(window.location.search);
      const accessToken = hash.get('access_token') || '';
      const refreshToken = hash.get('refresh_token') || '';
      const expiresIn = Number(hash.get('expires_in') || 3600);
      const providerError = hash.get('error_description') || query.get('error_description');

      if (providerError) throw new Error(providerError);
      if (!accessToken || !refreshToken) {
        throw new Error('Liên kết xác nhận không có phiên đăng nhập hợp lệ hoặc đã hết hạn.');
      }

      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adopt-session',
          accessToken,
          refreshToken,
          expiresIn
        })
      });
      const data = await response.json().catch(() => ({})) as SessionResponse;
      if (!response.ok || !data.ok) throw new Error(data.message || 'Không thể hoàn tất xác nhận email.');

      if (!active) return;
      setStatus('Xác nhận thành công. Đang chuyển vào ứng dụng...');
      window.history.replaceState({}, '', '/auth/confirm');
      window.location.replace('/');
    }

    confirm().catch((error) => {
      if (!active) return;
      setFailed(true);
      setStatus(error instanceof Error ? error.message : 'Không thể xác nhận tài khoản.');
      window.history.replaceState({}, '', '/auth/confirm');
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={failed ? styles.errorIcon : styles.icon}>{failed ? '!' : '✓'}</div>
        <h1>{failed ? 'Xác nhận chưa thành công' : 'Xác nhận email'}</h1>
        <p>{status}</p>
        {failed ? <a href="/login">Quay lại đăng nhập</a> : null}
      </section>
    </main>
  );
}
