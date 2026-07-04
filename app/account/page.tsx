'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

type AccountData = {
  ok: boolean;
  message?: string;
  user?: { id: string; email: string };
  profile?: {
    plan?: string;
    credits?: number;
    hourly_scene_limit?: number;
    max_active_scenes?: number;
  };
  generations?: Array<{
    id?: string;
    status?: string;
    model?: string;
    output_url?: string;
    error_message?: string;
    created_at?: string;
  }>;
};

function formatDate(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

export default function AccountPage() {
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/account', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as AccountData;
        if (!response.ok || !payload.ok) throw new Error(payload.message || 'Không đọc được tài khoản.');
        setData(payload);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Không đọc được tài khoản.'));
  }, []);

  const stats = useMemo(() => {
    const generations = data?.generations || [];
    return {
      total: generations.length,
      succeeded: generations.filter((item) => item.status === 'succeeded').length,
      active: generations.filter((item) => ['reserved', 'submitted', 'processing'].includes(item.status || '')).length
    };
  }, [data]);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>TÀI KHOẢN SAAS</span>
          <h1>Gói sử dụng và lịch sử tạo video</h1>
          <p>{data?.user?.email || 'Đang tải thông tin tài khoản...'}</p>
        </div>
        <a href="/" className={styles.primaryLink}>Tạo video mới</a>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.stats}>
        <article>
          <span>Credit còn lại</span>
          <strong>{data?.profile?.credits ?? '—'}</strong>
          <small>Mỗi cảnh 8 giây mặc định dùng 1 credit</small>
        </article>
        <article>
          <span>Gói hiện tại</span>
          <strong>{String(data?.profile?.plan || 'trial').toUpperCase()}</strong>
          <small>{data?.profile?.hourly_scene_limit ?? '—'} cảnh tối đa mỗi giờ</small>
        </article>
        <article>
          <span>Đang xử lý</span>
          <strong>{stats.active}</strong>
          <small>Tối đa {data?.profile?.max_active_scenes ?? '—'} cảnh đồng thời</small>
        </article>
        <article>
          <span>Hoàn thành gần đây</span>
          <strong>{stats.succeeded}/{stats.total}</strong>
          <small>Trong 20 lượt gần nhất</small>
        </article>
      </section>

      <section className={styles.history}>
        <div className={styles.sectionHeader}>
          <h2>Lịch sử tạo video</h2>
          <span>20 cảnh gần nhất</span>
        </div>

        {!data ? <div className={styles.empty}>Đang tải...</div> : null}
        {data && !(data.generations || []).length ? (
          <div className={styles.empty}>Chưa có lượt tạo video nào.</div>
        ) : null}

        <div className={styles.list}>
          {(data?.generations || []).map((item) => (
            <article key={item.id} className={styles.job}>
              <div>
                <strong>{item.model || 'Veo 3.1'}</strong>
                <span>{formatDate(item.created_at)}</span>
              </div>
              <span className={`${styles.status} ${styles[item.status || 'unknown'] || ''}`}>
                {item.status || 'unknown'}
              </span>
              {item.output_url ? <a href={item.output_url} target="_blank" rel="noreferrer">Mở video</a> : <span />}
              {item.error_message ? <p>{item.error_message}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
