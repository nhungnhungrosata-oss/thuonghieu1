import { NextRequest, NextResponse } from 'next/server';
import { payloadHash, verifyStripeSignature } from '../../../../lib/saas/billing';
import { callAdminRpc } from '../../../../lib/saas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > 1_000_000) return NextResponse.json({ ok: false }, { status: 413 });
    const raw = await request.text();
    if (raw.length > 1_000_000) return NextResponse.json({ ok: false }, { status: 413 });
    const signature = request.headers.get('stripe-signature') || '';
    if (!verifyStripeSignature(raw, signature)) return NextResponse.json({ ok: false }, { status: 400 });
    const event = JSON.parse(raw) as { id: string; type: string; data?: { object?: Record<string, any> } };
    const object = event.data?.object || {};
    const metadata = object.metadata || {};
    const hash = payloadHash(raw);
    const orderId = String(metadata.order_id || '');
    const isOrderId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);

    if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && object.payment_status === 'paid') {
      if (!isOrderId) return NextResponse.json({ received: true, ignored: true });
      await callAdminRpc('complete_stripe_payment', {
        p_event_id: event.id,
        p_event_type: event.type,
        p_payload_hash: hash,
        p_order_id: orderId,
        p_session_id: String(object.id || ''),
        p_payment_intent_id: String(object.payment_intent || ''),
        p_amount_total: Number(object.amount_total || 0),
        p_currency: String(object.currency || '')
      });
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      if (!isOrderId) return NextResponse.json({ received: true, ignored: true });
      await callAdminRpc('mark_stripe_payment_status', {
        p_event_id: event.id,
        p_event_type: event.type,
        p_payload_hash: hash,
        p_order_id: orderId,
        p_session_id: String(object.id || ''),
        p_status: event.type === 'checkout.session.expired' ? 'expired' : 'failed',
        p_reason: event.type
      });
    } else if (event.type === 'charge.refunded') {
      await callAdminRpc('refund_stripe_payment', {
        p_event_id: event.id,
        p_event_type: event.type,
        p_payload_hash: hash,
        p_payment_intent_id: String(object.payment_intent || ''),
        p_reason: 'Stripe charge refunded',
        p_amount_refunded: Number(object.amount_refunded || 0),
        p_charge_amount: Number(object.amount || 0),
        p_currency: String(object.currency || '')
      });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Webhook lỗi.' }, { status: 400 });
  }
}
