'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

type AuthResponse = {
  ok?: boolean;
  message?: string;
  requiresEmailConfirmation?: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [nextPath, setNextPath] = useState('/');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    setNextPath(next?.startsWith('/') ? next : '/');
    setMessage(params.get('notice') || '');
    setError(params.get('error') || '');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          email: form.get('email'),
          password: form.get('password')
        })
      });

      const rawBody = await response.text();
      let data: AuthResponse;

      try {
        data = rawBody ? (JSON.parse(rawBody) as AuthResponse) : {};
      } catch {
        throw new Error(
          `Máy chủ xác thực đang lỗi (${response.status}). Hãy kiểm tra Vercel Runtime Logs rồi thử lại.`
        );
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.message || 'Không thể xác thực.');
      }

      if (data.requiresEmailConfirmation) {
        setMessage(data.message || 'Hãy kiểm tra email.');
        setMode('login');
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xác thực.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span className={styles.badge}>VIDEO AI SAAS</span>
        <h1>{mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</h1>
        <p>Mỗi khách hàng có credit, lịch sử video và dữ liệu riêng.</p>
        <div className={styles.tabs}>
          <button type="button" className={mode === 'login' ? styles.active : ''} onClick={() => setMode('login')}>
            Đăng nhập
          </button>
          <button type="button" className={mode === 'signup' ? styles.active : ''} onClick={() => setMode('signup')}>
            Đăng ký
          </button>
        </div>
        <form onSubmit={submit}>
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
          <button className={styles.submit} disabled={loading}>
            {loading ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản miễn phí'}
          </button>
        </form>
        {message ? <div className={styles.notice}>{message}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        <small>API key được giữ ở backend và không hiển thị trên trình duyệt.</small>
      </section>
    </main>
  );
}
