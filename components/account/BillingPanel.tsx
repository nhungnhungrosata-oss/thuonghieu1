'use client';

import { useEffect, useState } from 'react';
import styles from './BillingPanel.module.css';

type Pack = {
  id: string;
  name: string;
  description: string;
  credits: number;
  amount: number;
  currency: string;
  highlighted?: boolean;
};

type Payment = {
  id?: string;
  pack_id?: string;
  credits?: number;
  amount?: number;
  currency?: string;
  status?: string;
  created_at?: string;
  paid_at?: string;
  failure_reason?: string;
};

type Props = { payments: Payment[]; onError: (message: string) => void };

function money(amount = 0, currency = 'usd') {
  const zeroDecimal = new Set(['vnd', 'jpy', 'krw', 'clp', 'pyg', 'xaf', 'xof', 'xpf']);
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency', currency: currency.toUpperCase()
  }).format(amount / (zeroDecimal.has(currency.toLowerCase()) ? 1 : 100));
}

export default function BillingPanel({ payments, onError }: Props) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [buying, setBuying] = useState('');

  useEffect(() => {
    fetch('/api/billing/catalog', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => setPacks(Array.isArray(data.packs) ? data.packs : []))
      .catch(() => onError('Không tải được bảng giá credit.'));
  }, [onError]);

  async function buy(packId: string) {
    setBuying(packId);
    onError('');
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': crypto.randomUUID()
        },
        body: JSON.stringify({ packId })
      });
      const data = await response.json() as { ok?: boolean; checkoutUrl?: string; message?: string };
      if (!response.ok || !data.checkoutUrl) throw new Error(data.message || 'Không tạo được trang thanh toán.');
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không thể thanh toán.');
      setBuying('');
    }
  }

  return (
    <>
      <section className={styles.section}>
        <div className={styles.header}>
          <div><span>MUA CREDIT</span><h2>Chọn gói phù hợp</h2></div>
          <small>Thanh toán qua Stripe Checkout</small>
        </div>
        <div className={styles.packs}>
          {packs.map((pack) => (
            <article key={pack.id} className={pack.highlighted ? styles.highlighted : ''}>
              <strong>{pack.name}</strong>
              <b>{pack.credits} credit</b>
              <p>{pack.description}</p>
              <div>{money(pack.amount, pack.currency)}</div>
              <button disabled={Boolean(buying)} onClick={() => buy(pack.id)} type="button">
                {buying === pack.id ? 'Đang mở thanh toán...' : 'Mua gói này'}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.header}>
          <div><span>THANH TOÁN</span><h2>Lịch sử giao dịch</h2></div>
          <small>20 giao dịch gần nhất</small>
        </div>
        <div className={styles.payments}>
          {!payments.length ? <p>Chưa có giao dịch nào.</p> : payments.map((item) => (
            <article key={item.id}>
              <div><strong>{String(item.pack_id || 'credit').toUpperCase()}</strong><small>{item.credits || 0} credit</small></div>
              <b>{money(item.amount, item.currency)}</b>
              <span data-status={item.status}>{item.status}</span>
              <time>{item.created_at ? new Date(item.created_at).toLocaleString('vi-VN') : '—'}</time>
              {item.failure_reason ? <p>{item.failure_reason}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
