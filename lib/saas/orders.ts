import { parseSupabaseError, supabaseAdminRequest, supabaseUserRpc } from './supabase-admin';

export async function createOrder(input: {
  accessToken: string;
  idempotencyKey: string;
  packId: string;
  targetPlan: string;
  credits: number;
  amount: number;
  currency: string;
}) {
  const response = await supabaseUserRpc(input.accessToken, 'create_payment_order', {
    p_client_idempotency_key: input.idempotencyKey,
    p_pack_id: input.packId,
    p_target_plan: input.targetPlan,
    p_credits: input.credits,
    p_amount: input.amount,
    p_currency: input.currency
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  const rows = await response.json() as Array<Record<string, unknown>>;
  const row = rows[0] || {};
  return {
    orderId: String(row.order_id || ''),
    reused: Boolean(row.reused),
    status: String(row.order_status || ''),
    checkoutUrl: String(row.checkout_url || '')
  };
}

export async function attachOrderSession(orderId: string, sessionId: string, checkoutUrl: string) {
  const response = await supabaseAdminRequest(`payment_orders?id=eq.${encodeURIComponent(orderId)}&status=eq.pending`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ provider_session_id: sessionId, checkout_url: checkoutUrl, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
}
