import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type CreditPack = {
  id: 'starter' | 'pro' | 'business';
  name: string;
  description: string;
  credits: number;
  targetPlan: 'starter' | 'pro' | 'business';
  amount: number;
  currency: string;
  highlighted?: boolean;
};

function positiveEnv(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getCreditPacks(): CreditPack[] {
  const currency = /^[a-z]{3}$/.test(process.env.STRIPE_CURRENCY?.trim().toLowerCase() || '')
    ? process.env.STRIPE_CURRENCY!.trim().toLowerCase()
    : 'usd';
  return [
    { id: 'starter', name: 'Starter', description: 'Dành cho người mới bắt đầu.', credits: 50, targetPlan: 'starter', amount: positiveEnv('STRIPE_STARTER_AMOUNT', 990), currency },
    { id: 'pro', name: 'Pro', description: 'Dành cho nhà sáng tạo và đội bán hàng nhỏ.', credits: 150, targetPlan: 'pro', amount: positiveEnv('STRIPE_PRO_AMOUNT', 2490), currency, highlighted: true },
    { id: 'business', name: 'Business', description: 'Dành cho đội nhóm có nhu cầu cao.', credits: 400, targetPlan: 'business', amount: positiveEnv('STRIPE_BUSINESS_AMOUNT', 5990), currency }
  ];
}

export function getCreditPack(id: string) {
  return getCreditPacks().find((pack) => pack.id === id) || null;
}

function getStripeSecret() {
  const value = process.env.STRIPE_SECRET_KEY?.trim();
  if (!value) throw new Error('Thiếu STRIPE_SECRET_KEY.');
  return value;
}

export async function createStripeCheckout(input: {
  origin: string;
  userId: string;
  email: string;
  orderId: string;
  pack: CreditPack;
}) {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', `${input.origin}/account?payment=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${input.origin}/account?payment=cancelled`);
  form.set('client_reference_id', input.userId);
  form.set('customer_email', input.email);
  form.set('locale', 'auto');
  form.set('invoice_creation[enabled]', 'true');
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', input.pack.currency);
  form.set('line_items[0][price_data][unit_amount]', String(input.pack.amount));
  form.set('line_items[0][price_data][product_data][name]', `${input.pack.name} - ${input.pack.credits} credit`);
  form.set('line_items[0][price_data][product_data][description]', input.pack.description);
  form.set('metadata[order_id]', input.orderId);
  form.set('metadata[user_id]', input.userId);
  form.set('metadata[pack_id]', input.pack.id);
  form.set('payment_intent_data[metadata][order_id]', input.orderId);
  form.set('payment_intent_data[metadata][user_id]', input.userId);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getStripeSecret()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': input.orderId
    },
    body: form.toString(),
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(String(data.error?.message || 'Stripe không tạo được trang thanh toán.'));
  const id = String(data.id || '');
  const url = String(data.url || '');
  if (!id || !url) throw new Error('Stripe trả dữ liệu checkout không đầy đủ.');
  return { id, url };
}

export function payloadHash(payload: string) {
  return createHash('sha256').update(payload).digest('hex');
}

export function verifyStripeSignature(payload: string, header: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error('Thiếu STRIPE_WEBHOOK_SECRET.');
  const values = header.split(',').map((part) => part.trim());
  const timestamp = Number(values.find((part) => part.startsWith('t='))?.slice(2));
  const signatures = values.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return signatures.some((signature) => {
    try {
      const actual = Buffer.from(signature, 'hex');
      return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
    } catch { return false; }
  });
}
