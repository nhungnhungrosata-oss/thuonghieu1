import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CreditPack } from './credit-packs';

export type StripeCheckoutSession = {
  id: string;
  url: string;
};

export type StripeEvent = {
  id: string;
  type: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

export function getStripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey) throw new Error('Thiếu STRIPE_SECRET_KEY trong Environment Variables.');
  return { secretKey, webhookSecret };
}

export function hashPayload(payload: string) {
  return createHash('sha256').update(payload).digest('hex');
}

function safeHexEqual(left: string, right: string) {
  try {
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

export function verifyStripeSignature(input: {
  payload: string;
  signatureHeader: string;
  webhookSecret: string;
  toleranceSeconds?: number;
}) {
  const toleranceSeconds = input.toleranceSeconds ?? 300;
  const parts = input.signatureHeader.split(',').map((part) => part.trim());
  const timestampText = parts.find((part) => part.startsWith('t='))?.slice(2) || '';
  const signatures = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  const timestamp = Number(timestampText);

  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) return false;

  const expected = createHmac('sha256', input.webhookSecret)
    .update(`${timestamp}.${input.payload}`)
    .digest('hex');

  return signatures.some((signature) => safeHexEqual(signature, expected));
}

export async function createStripeCheckoutSession(input: {
  origin: string;
  userId: string;
  email: string;
  orderId: string;
  pack: CreditPack;
}) {
  const { secretKey } = getStripeConfig();
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
  form.set('metadata[credits]', String(input.pack.credits));
  form.set('payment_intent_data[metadata][order_id]', input.orderId);
  form.set('payment_intent_data[metadata][user_id]', input.userId);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': input.orderId
    },
    body: form.toString(),
    cache: 'no-store'
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined;
    throw new Error(String(error?.message || 'Stripe không tạo được trang thanh toán.'));
  }

  const id = String(payload.id || '');
  const url = String(payload.url || '');
  if (!id || !url) throw new Error('Stripe phản hồi thiếu session ID hoặc checkout URL.');
  return { id, url } satisfies StripeCheckoutSession;
}
