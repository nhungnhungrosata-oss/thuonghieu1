import { parseSupabaseError, supabaseAdminRequest } from './supabase-admin';

export async function getAccountSnapshotV2(userId: string) {
  const profileQuery = new URLSearchParams({
    select: 'id,email,plan,credits,hourly_scene_limit,max_active_scenes,video_retention_days,created_at',
    id: `eq.${userId}`,
    limit: '1'
  });
  const profileResponse = await supabaseAdminRequest(`profiles?${profileQuery.toString()}`);
  if (!profileResponse.ok) throw new Error(await parseSupabaseError(profileResponse));
  const profiles = await profileResponse.json() as Array<Record<string, unknown>>;

  const jobsQuery = new URLSearchParams({
    select: 'id,status,model,error_message,storage_status,storage_path,created_at,completed_at',
    user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: '20'
  });
  const jobsResponse = await supabaseAdminRequest(`generations?${jobsQuery.toString()}`);
  if (!jobsResponse.ok) throw new Error(await parseSupabaseError(jobsResponse));
  const generations = await jobsResponse.json() as Array<Record<string, unknown>>;

  const paymentsQuery = new URLSearchParams({
    select: 'id,pack_id,target_plan,credits,amount,currency,status,failure_reason,created_at,paid_at',
    user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: '20'
  });
  const paymentsResponse = await supabaseAdminRequest(`payment_orders?${paymentsQuery.toString()}`);
  if (!paymentsResponse.ok) throw new Error(await parseSupabaseError(paymentsResponse));
  const payments = await paymentsResponse.json() as Array<Record<string, unknown>>;

  return {
    profile: profiles[0] || null,
    generations: generations.map((item) => ({
      ...item,
      download_url: item.storage_status === 'archived' ? `/api/videos/${item.id}/download` : null
    })),
    payments
  };
}
