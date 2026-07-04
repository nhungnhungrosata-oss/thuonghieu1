'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import BillingPanel from '../../components/account/BillingPanel';
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
    video_retention_days?: number;
  };
  generations?: Array<{
    id?: string;
    status?: string;
    model?: string;
    storage_status?: string;
    download_url?: string;
    error_message?: string;
    created_at?: string;
  }>;
  payments?: Array<Record<string, unknown>>;
};

function formatDate(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export default function AccountPage() {
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    fetch('/api/account', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as AccountData;
        if (!response.ok || !payload.ok) throw new Error(payload.message || 'Không đọc được tài khoản.');
        setData(payload);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Không đọc được tài khoản.'));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') setNotice('Thanh toán đã hoàn tất. Credit sẽ được cộng ngay khi Stripe xác nhận webhook.');
    if (params.get('payment') === 'cancelled') setNotice('Bạn đã hủy thanh toán. Không có credit nào bị thay đổi.');
    load();
  }, [load]);

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
          <h1>Gói sử dụng, credit và video</h1>
          <p>{data?.user?.email || 'Đang tải thông tin tài khoản...'}</p>
        </div>
        <a href="/" className={styles.primaryLink}>Tạo video mới</a>
      </section>

      {notice ? <div className={styles.notice}>{notice}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.stats}>
        <article><span>Credit còn lại</span><strong>{data?.profile?.credits ?? '—'}</strong><small>Mỗi cảnh 8 giây dùng 1 credit</small></article>
        <article><span>Gói hiện tại</span><strong>{String(data?.profile?.plan || 'trial').toUpperCase()}</strong><small>{data?.profile?.hourly_scene_limit ?? '—'} cảnh mỗi giờ</small></article>
        <article><span>Đang xử lý</span><strong>{stats.active}</strong><small>Tối đa {data?.profile?.max_active_scenes ?? '—'} cảnh đồng thời</small></article>
        <article><span>Lưu video</span><strong>{data?.profile?.video_retention_days ?? '—'} ngày</strong><small>{stats.succeeded}/{stats.total} cảnh hoàn thành gần đây</small></article>
      </section>

      <BillingPanel payments={(data?.payments || []) as never[]} onError={setError} />

      <section className={styles.history}>
        <div className={styles.sectionHeader}><h2>Lịch sử tạo video</h2><span>20 cảnh gần nhất</span></div>
        {!data ? <div className={styles.empty}>Đang tải...</div> : null}
        {data && !(data.generations || []).length ? <div className={styles.empty}>Chưa có lượt tạo video nào.</div> : null}
        <div className={styles.list}>
          {(data?.generations || []).map((item) => (
            <article key={item.id} className={styles.job}>
              <div><strong>{item.model || 'Veo 3.1'}</strong><span>{formatDate(item.created_at)}</span></div>
              <span className={`${styles.status} ${styles[item.status || 'unknown'] || ''}`}>{item.status || 'unknown'}</span>
              <span className={styles.storage}>{item.storage_status || 'pending'}</span>
              {item.download_url ? <a href={item.download_url}>Mở video đã lưu</a> : <span />}
              {item.error_message ? <p>{item.error_message}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
