'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from './page.module.css';

type AuthResponse = {
  ok?: boolean;
  message?: string;
  requiresEmailConfirmation?: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(searchParams.get('notice') || '');
  const [error, setError] = useState(searchParams.get('error') || '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: mode,
        email: form.get('email'),
        password: form.get('password')
      })
    });
    const data = await response.json().catch(() => ({})) as AuthResponse;
    setLoading(false);

    if (!response.ok || !data.ok) {
      setError(data.message || 'Không thể đăng nhập.');
      return;
    }

    if (data.requiresEmailConfirmation) {
      setMessage(data.message || 'Hãy kiểm tra email để xác nhận tài khoản.');
      setMode('login');
      return;
    }

    const next = searchParams.get('next');
    router.replace(next?.startsWith('/') ? next : '/');
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.badge}>VIDEO AI SAAS</div>
        <h1>{mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</h1>
        <p className={styles.subtitle}>
          Mỗi tài khoản có credit, lịch sử và hàng đợi tạo video riêng.
        </p>

        <div className={styles.tabs}>
          <button className={mode === 'login' ? styles.activeTab : ''} onClick={() => setMode('login')} type="button">
            Đăng nhập
          </button>
          <button className={mode === 'signup' ? styles.activeTab : ''} onClick={() => setMode('signup')} type="button">
            Đăng ký
          </button>
        </div>

        <form onSubmit={submit} className={styles.form}>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required placeholder="ban@email.com" />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              type="password"
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              placeholder="Tối thiểu 8 ký tự"
            />
          </label>
          <button className={styles.submit} disabled={loading} type="submit">
            {loading ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập và tạo video' : 'Tạo tài khoản miễn phí'}
          </button>
        </form>

        {message ? <div className={styles.notice}>{message}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        <p className={styles.footnote}>
          Không chia sẻ API key Google Flow. Toàn bộ key được giữ ở backend của hệ thống.
        </p>
      </section>
    </main>
  );
}
