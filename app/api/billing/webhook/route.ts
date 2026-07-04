import { NextRequest, NextResponse } from 'next/server';
import { parseSupabaseError, supabaseAdminRequest } from '../../../../lib/saas/supabase-admin';
import { getStripeConfig, hashPayload, verifyStripeSignature, type StripeEvent } from '../../../../lib/saas/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function callRpc(name: string, body: Record<string, unknown>) {
  const response = await supabaseAdminRequest(`rpc/${name}`, {
    method: 'POST', body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  return response.json().catch(() => null);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature') || '';
    const { webhookSecret } = getStripeConfig();
    if (!webhookSecret) throw new Error('Thiếu STRIPE_WEBHOOK_SECRET trong Environment Variables.');
    if (!verifyStripeSignature({ payload: rawBody, signatureHeader: signature, webhookSecret })) {
      return NextResponse.json({ ok: false, message: 'Chữ ký webhook không hợp lệ.' }, { status: 400 });
    }

    const event = JSON.parse(rawBody) as StripeEvent;
    const object = event.data?.object || {};
    const payloadHash = hashPayload(rawBody);

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const metadata = object.metadata as Record<string, unknown> | undefined;
      const paymentStatus = String(object.payment_status || '');
      if (paymentStatus === 'paid') {
        await callRpc('complete_stripe_payment', {
          p_event_id: event.id,
          p_event_type: event.type,
          p_payload_hash: payloadHash,
          p_order_id: String(metadata?.order_id || ''),
          p_session_id: String(object.id || ''),
          p_payment_intent_id: String(object.payment_intent || ''),
          p_amount_total: Number(object.amount_total || 0),
          p_currency: String(object.currency || '')
        });
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const metadata = object.metadata as Record<string, unknown> | undefined;
      await callRpc('mark_stripe_payment_status', {
        p_event_id: event.id,
        p_event_type: event.type,
        p_payload_hash: payloadHash,
        p_order_id: String(metadata?.order_id || ''),
        p_session_id: String(object.id || ''),
        p_status: event.type === 'checkout.session.expired' ? 'expired' : 'failed',
        p_reason: event.type
      });
    } else if (event.type === 'charge.refunded') {
      await callRpc('refund_stripe_payment', {
        p_event_id: event.id,
        p_event_type: event.type,
        p_payload_hash: payloadHash,
        p_payment_intent_id: String(object.payment_intent || ''),
        p_reason: 'Stripe charge refunded'
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Webhook xử lý thất bại.' },
      { status: 400 }
    );
  }
}
