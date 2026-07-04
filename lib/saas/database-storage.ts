import { parseSupabaseError, supabaseAdminRequest } from './supabase-admin';

export async function markGenerationArchived(input: { generationId: string; bucket: string; path: string; sizeBytes: number }) {
  const response = await supabaseAdminRequest(`generations?id=eq.${encodeURIComponent(input.generationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      storage_bucket: input.bucket,
      storage_path: input.path,
      storage_status: 'archived',
      storage_error: null,
      output_size_bytes: input.sizeBytes,
      archive_attempt_count: 1,
      last_archive_attempt_at: new Date().toISOString(),
      archived_at: new Date().toISOString(),
      reconcile_locked_until: null,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
}

export async function markGenerationArchiveFailed(generationId: string, message: string) {
  const response = await supabaseAdminRequest(`generations?id=eq.${encodeURIComponent(generationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      storage_status: 'failed',
      storage_error: message.slice(0, 2000),
      last_archive_attempt_at: new Date().toISOString(),
      reconcile_locked_until: null,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
}

export async function markGenerationStorageDeleted(generationId: string) {
  const response = await supabaseAdminRequest(`generations?id=eq.${encodeURIComponent(generationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      storage_status: 'deleted',
      storage_path: null,
      output_url: null,
      storage_deleted_at: new Date().toISOString(),
      reconcile_locked_until: null,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
}

export async function getGenerationByIdForUser(userId: string, generationId: string) {
  const query = new URLSearchParams({ select: '*', user_id: `eq.${userId}`, id: `eq.${generationId}`, limit: '1' });
  const response = await supabaseAdminRequest(`generations?${query.toString()}`);
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  const rows = await response.json() as Array<Record<string, unknown>>;
  return rows[0] || null;
}

export async function claimGenerationReconciliationBatch(limit = 20) {
  const response = await supabaseAdminRequest('rpc/claim_generation_reconciliation_batch', {
    method: 'POST', body: JSON.stringify({ p_limit: limit })
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  return response.json() as Promise<Array<Record<string, any>>>;
}

export async function claimExpiredStorageBatch(limit = 20) {
  const response = await supabaseAdminRequest('rpc/claim_expired_storage_batch', {
    method: 'POST', body: JSON.stringify({ p_limit: limit })
  });
  if (!response.ok) throw new Error(await parseSupabaseError(response));
  return response.json() as Promise<Array<{ id: string; user_id: string; storage_bucket: string; storage_path: string }>>;
}

export async function releaseReconciliationLock(generationId: string) {
  await supabaseAdminRequest(`generations?id=eq.${encodeURIComponent(generationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ reconcile_locked_until: null, updated_at: new Date().toISOString() })
  });
}
