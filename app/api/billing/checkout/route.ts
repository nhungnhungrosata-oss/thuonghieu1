import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authenticationErrorResponse, requireApiUser } from '../../../../lib/saas/auth';
import { getCreditPack } from '../../../../lib/saas/credit-packs';
import { attachOrderSession, createOrder } from '../../../../lib/saas/orders';
import { createStripeCheckoutSession } from '../../../../lib/saas/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { user, accessToken } = await requireApiUser(request);
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, message: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const pack = getCreditPack(String(body.packId || ''));
    if (!pack) return NextResponse.json({ ok: false, message: 'Gói credit không hợp lệ.' }, { status: 400 });

    const requestKey = request.headers.get('x-idempotency-key')?.trim() || randomUUID();
    const idempotencyKey = createHash('sha256')
      .update(user.id)
      .update(pack.id)
      .update(requestKey)
      .digest('hex');

    const order = await createOrder({
      accessToken,
      idempotencyKey,
      packId: pack.id,
      targetPlan: pack.targetPlan,
      credits: pack.credits,
      amount: pack.amount,
      currency: pack.currency
    });

    if (order.reused && order.checkoutUrl) {
      return NextResponse.json({ ok: true, checkoutUrl: order.checkoutUrl, reused: true });
    }
    if (!order.orderId) throw new Error('Không nhận được mã đơn thanh toán.');

    const session = await createStripeCheckoutSession({
      origin: request.nextUrl.origin,
      userId: user.id,
      email: user.email,
      orderId: order.orderId,
      pack
    });
    await attachOrderSession(order.orderId, session.id, session.url);

    return NextResponse.json({ ok: true, checkoutUrl: session.url });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') {
      return authenticationErrorResponse(error);
    }
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Không thể tạo trang thanh toán.' },
      { status: 500 }
    );
  }
}
