import { adminRequest, parseSupabaseError, userRpc } from './supabase';

export type Generation = {
  id: string;
  user_id: string;
  status: string;
  provider_status: string | null;
  provider_job_id: string | null;
  provider_asset_id: string | null;
  output_url: string | null;
  storage_status: string;
  storage_bucket: string | null;
  storage_path: string | null;
  cost_credits: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

async function patch(table: string, id: string, body: Record<string, unknown>) {
  const response = await adminRequest(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
}

export async function reserveGeneration(input: {
  accessToken: string;
  idempotencyKey: string;
  prompt: string;
  model: string;
}) {
  const response = await userRpc(input.accessToken, 'reserve_video_generation', {
    p_idempotency_key: input.idempotencyKey,
    p_prompt: input.prompt,
    p_model: input.model,
    p_cost_credits: 1
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  const rows = await response.json() as Array<Record<string, unknown>>;
  const row = rows[0] || {};
  return {
    generationId: String(row.generation_id || ''),
    allowed: Boolean(row.allowed),
    reused: Boolean(row.reused),
    reason: String(row.reason || ''),
    providerJobId: String(row.provider_job_id || '')
  };
}

export async function markSubmitted(id: string, jobId: string, assetId: string) {
  return patch('generations', id, {
    status: 'submitted', provider_status: 'created', provider_job_id: jobId,
    provider_asset_id: assetId, submitted_at: new Date().toISOString()
  });
}


export async function linkGenerationProviderJob(id: string, jobId: string, assetId = '') {
  return patch('generations', id, {
    status: 'submitted',
    provider_status: 'created',
    provider_job_id: jobId,
    provider_asset_id: assetId || null,
    submitted_at: new Date().toISOString(),
    reconcile_locked_until: null
  });
}

export async function markProcessing(id: string, providerStatus: string) {
  return patch('generations', id, {
    status: 'processing', provider_status: providerStatus,
    started_at: new Date().toISOString(), reconcile_locked_until: null
  });
}

export async function markSucceeded(id: string, providerStatus: string, url: string, assetId: string) {
  return patch('generations', id, {
    status: 'succeeded', provider_status: providerStatus, output_url: url,
    provider_asset_id: assetId || null, storage_status: 'pending',
    completed_at: new Date().toISOString(), reconcile_locked_until: null
  });
}

export async function markArchived(id: string, stored: { bucket: string; path: string; sizeBytes: number }) {
  return patch('generations', id, {
    storage_status: 'archived', storage_bucket: stored.bucket, storage_path: stored.path,
    output_size_bytes: stored.sizeBytes, storage_error: null,
    archived_at: new Date().toISOString(), last_archive_attempt_at: new Date().toISOString(),
    archive_attempt_count: 1, reconcile_locked_until: null
  });
}

export async function markArchiveFailed(id: string, message: string) {
  return patch('generations', id, {
    storage_status: 'failed', storage_error: message.slice(0, 2000),
    last_archive_attempt_at: new Date().toISOString(), reconcile_locked_until: null
  });
}

export async function refundGeneration(id: string, message: string) {
  const response = await adminRequest('rpc/fail_and_refund_generation', {
    method: 'POST',
    body: JSON.stringify({ p_generation_id: id, p_error_message: message.slice(0, 2000) })
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
}

export async function getGenerationByJob(userId: string, jobId: string) {
  const query = new URLSearchParams({ select: '*', user_id: `eq.${userId}`, provider_job_id: `eq.${jobId}`, limit: '1' });
  const response = await adminRequest(`generations?${query}`);
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  return ((await response.json()) as Generation[])[0] || null;
}

export async function getOwnedRecord(table: 'generations' | 'video_outputs', userId: string, id: string) {
  const query = new URLSearchParams({ select: '*', user_id: `eq.${userId}`, id: `eq.${id}`, limit: '1' });
  const response = await adminRequest(`${table}?${query}`);
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  return ((await response.json()) as Array<Record<string, any>>)[0] || null;
}

export async function createVideoOutput(userId: string, aspectRatio: string, title: string) {
  const response = await adminRequest('video_outputs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, aspect_ratio: aspectRatio, title: title.slice(0, 200), status: 'processing' })
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  return ((await response.json()) as Array<{ id: string }>)[0];
}

export async function completeVideoOutput(id: string, stored: { bucket: string; path: string; sizeBytes: number }) {
  return patch('video_outputs', id, {
    status: 'succeeded', storage_bucket: stored.bucket, storage_path: stored.path,
    size_bytes: stored.sizeBytes, completed_at: new Date().toISOString(), error_message: null
  });
}

export async function failVideoOutput(id: string, message: string) {
  return patch('video_outputs', id, { status: 'failed', error_message: message.slice(0, 2000) });
}

export async function createPaymentOrder(input: {
  accessToken: string; key: string; packId: string; plan: string; credits: number; amount: number; currency: string;
}) {
  const response = await userRpc(input.accessToken, 'create_payment_order', {
    p_client_idempotency_key: input.key,
    p_pack_id: input.packId,
    p_target_plan: input.plan,
    p_credits: input.credits,
    p_amount: input.amount,
    p_currency: input.currency
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  const row = ((await response.json()) as Array<Record<string, unknown>>)[0] || {};
  return {
    id: String(row.order_id || ''), reused: Boolean(row.reused),
    status: String(row.order_status || ''), checkoutUrl: String(row.checkout_url || '')
  };
}

export async function attachCheckout(id: string, sessionId: string, url: string) {
  return patch('payment_orders', id, { provider_session_id: sessionId, checkout_url: url });
}

export async function callAdminRpc(name: string, body: Record<string, unknown>) {
  const response = await adminRequest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  return response.json().catch(() => null);
}

export async function accountSnapshot(userId: string) {
  const queries = [
    `profiles?${new URLSearchParams({ select: '*', id: `eq.${userId}`, limit: '1' })}`,
    `generations?${new URLSearchParams({ select: 'id,status,model,storage_status,error_message,created_at,completed_at', user_id: `eq.${userId}`, order: 'created_at.desc', limit: '20' })}`,
    `video_outputs?${new URLSearchParams({ select: 'id,title,status,aspect_ratio,error_message,created_at,completed_at', user_id: `eq.${userId}`, order: 'created_at.desc', limit: '20' })}`,
    `payment_orders?${new URLSearchParams({ select: 'id,pack_id,target_plan,credits,amount,currency,status,failure_reason,created_at,paid_at', user_id: `eq.${userId}`, order: 'created_at.desc', limit: '20' })}`
  ];
  const responses = await Promise.all(queries.map((query) => adminRequest(query)));
  for (const response of responses) if (!response.ok) throw new Error(await parseSupabaseError(response));
  const [profiles, generations, outputs, payments] = await Promise.all(responses.map((response) => response.json()));
  return { profile: profiles[0] || null, generations, outputs, payments };
}
