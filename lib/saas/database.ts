import { getSupabaseConfig } from './config';

export type ReservationResult = {
  generationId: string;
  allowed: boolean;
  reused: boolean;
  reason: string;
  providerJobId: string;
};

export type StoredGeneration = {
  id: string;
  user_id: string;
  status: string;
  provider_status: string | null;
  provider_job_id: string | null;
  cost_credits: number;
};

async function parseError(response: Response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { message?: string; error_description?: string; hint?: string };
    return data.message || data.error_description || data.hint || text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

async function adminRequest(path: string, init: RequestInit = {}) {
  const { url, serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
  const headers = new Headers(init.headers);
  headers.set('apikey', serviceRoleKey!);
  headers.set('Authorization', `Bearer ${serviceRoleKey}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers,
    cache: 'no-store'
  });
}

export async function reserveVideoGeneration(input: {
  accessToken: string;
  idempotencyKey: string;
  prompt: string;
  model: string;
  costCredits?: number;
}): Promise<ReservationResult> {
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/rpc/reserve_video_generation`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_idempotency_key: input.idempotencyKey,
      p_prompt: input.prompt,
      p_model: input.model,
      p_cost_credits: input.costCredits || 1
    }),
    cache: 'no-store'
  });

  if (!response.ok) throw new Error(`Không thể giữ lượt tạo video: ${await parseError(response)}`);
  const payload = await response.json() as Array<Record<string, unknown>> | Record<string, unknown>;
  const row = Array.isArray(payload) ? payload[0] : payload;

  return {
    generationId: String(row?.generation_id || ''),
    allowed: Boolean(row?.allowed),
    reused: Boolean(row?.reused),
    reason: String(row?.reason || ''),
    providerJobId: String(row?.provider_job_id || '')
  };
}

export async function markGenerationSubmitted(input: {
  generationId: string;
  providerJobId: string;
  providerAssetId?: string;
}) {
  const response = await adminRequest(`generations?id=eq.${encodeURIComponent(input.generationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'submitted',
      provider_status: 'created',
      provider_job_id: input.providerJobId,
      provider_asset_id: input.providerAssetId || null,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(`Không lưu được job video: ${await parseError(response)}`);
}

export async function getGenerationForUser(userId: string, providerJobId: string): Promise<StoredGeneration | null> {
  const query = new URLSearchParams({
    select: 'id,user_id,status,provider_status,provider_job_id,cost_credits',
    user_id: `eq.${userId}`,
    provider_job_id: `eq.${providerJobId}`,
    limit: '1'
  });
  const response = await adminRequest(`generations?${query.toString()}`);
  if (!response.ok) throw new Error(`Không đọc được job: ${await parseError(response)}`);
  const rows = await response.json() as StoredGeneration[];
  return rows[0] || null;
}

export async function markGenerationProcessing(generationId: string, providerStatus: string) {
  const response = await adminRequest(`generations?id=eq.${encodeURIComponent(generationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'processing',
      provider_status: providerStatus,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(`Không cập nhật được trạng thái job: ${await parseError(response)}`);
}

export async function markGenerationSucceeded(input: {
  generationId: string;
  providerStatus: string;
  videoUrl: string;
  providerAssetId?: string;
}) {
  const response = await adminRequest(`generations?id=eq.${encodeURIComponent(input.generationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'succeeded',
      provider_status: input.providerStatus,
      output_url: input.videoUrl,
      provider_asset_id: input.providerAssetId || null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(`Không lưu được kết quả video: ${await parseError(response)}`);
}

export async function failAndRefundGeneration(generationId: string, errorMessage: string) {
  if (!generationId) return;
  const response = await adminRequest('rpc/fail_and_refund_generation', {
    method: 'POST',
    body: JSON.stringify({
      p_generation_id: generationId,
      p_error_message: errorMessage.slice(0, 2000)
    })
  });
  if (!response.ok) throw new Error(`Không hoàn được credit: ${await parseError(response)}`);
}

export async function getAccountSnapshot(userId: string) {
  const profileQuery = new URLSearchParams({
    select: 'id,email,plan,credits,hourly_scene_limit,max_active_scenes,created_at',
    id: `eq.${userId}`,
    limit: '1'
  });
  const profileResponse = await adminRequest(`profiles?${profileQuery.toString()}`);
  if (!profileResponse.ok) throw new Error(`Không đọc được tài khoản: ${await parseError(profileResponse)}`);
  const profiles = await profileResponse.json() as Array<Record<string, unknown>>;

  const jobsQuery = new URLSearchParams({
    select: 'id,status,model,output_url,error_message,created_at,completed_at',
    user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: '20'
  });
  const jobsResponse = await adminRequest(`generations?${jobsQuery.toString()}`);
  if (!jobsResponse.ok) throw new Error(`Không đọc được lịch sử: ${await parseError(jobsResponse)}`);
  const generations = await jobsResponse.json() as Array<Record<string, unknown>>;

  return { profile: profiles[0] || null, generations };
}
