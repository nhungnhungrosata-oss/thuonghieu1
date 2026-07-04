import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin, authenticationErrorResponse, requireApiUser } from '../../../../lib/saas/auth';
import { createStripeCheckout, getCreditPack } from '../../../../lib/saas/billing';
import { attachCheckout, createPaymentOrder } from '../../../../lib/saas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { user, accessToken } = await requireApiUser(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const pack = getCreditPack(String(body.packId || ''));
    if (!pack) return NextResponse.json({ ok: false, message: 'Gói credit không hợp lệ.' }, { status: 400 });
    const clientKey = request.headers.get('x-idempotency-key')?.trim() || randomUUID();
    const key = createHash('sha256').update(user.id).update(pack.id).update(clientKey).digest('hex');
    const order = await createPaymentOrder({
      accessToken, key, packId: pack.id, plan: pack.targetPlan,
      credits: pack.credits, amount: pack.amount, currency: pack.currency
    });
    if (order.reused && order.checkoutUrl) return NextResponse.json({ ok: true, checkoutUrl: order.checkoutUrl, reused: true });
    if (!order.id) throw new Error('Không tạo được mã đơn thanh toán.');
    const appOrigin = (process.env.APP_URL || request.nextUrl.origin).replace(/\/$/, '');
    const checkout = await createStripeCheckout({ origin: appOrigin, userId: user.id, email: user.email, orderId: order.id, pack });
    await attachCheckout(order.id, checkout.id, checkout.url);
    return NextResponse.json({ ok: true, checkoutUrl: checkout.url });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') return authenticationErrorResponse(error);
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Không thể tạo thanh toán.' }, { status: 500 });
  }
}
