import { NextRequest, NextResponse } from 'next/server';
import {
  callAdminRpc, markArchiveFailed, markArchived, markSucceeded, refundGeneration
} from '../../../../lib/saas/db';
import { adminRequest } from '../../../../lib/saas/supabase';
import { downloadRemoteVideo, removeStoredVideo, uploadVideo } from '../../../../lib/saas/storage';
import { fetchProviderJob } from '../../../../lib/useapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

async function unlock(id: string) {
  await adminRequest(`generations?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ reconcile_locked_until: null })
  });
}

async function archive(row: Record<string, any>, url: string) {
  try {
    const buffer = await downloadRemoteVideo(url);
    const stored = await uploadVideo(`${row.user_id}/scenes/${row.id}.mp4`, buffer);
    await markArchived(row.id, stored);
    return true;
  } catch (error) {
    await markArchiveFailed(row.id, error instanceof Error ? error.message : 'Lưu video thất bại.');
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const summary = { checked: 0, completed: 0, failed: 0, archived: 0, deleted: 0, errors: 0 };
  const rows = await callAdminRpc('claim_generation_reconciliation_batch', { p_limit: 15 }) as Array<Record<string, any>> || [];

  for (const row of rows) {
    summary.checked += 1;
    try {
      if (row.status === 'reserved' && !row.provider_job_id) {
        await refundGeneration(row.id, 'Yêu cầu bị treo trước khi gửi provider.');
        summary.failed += 1;
        continue;
      }
      if (row.status === 'succeeded' && row.output_url && row.storage_status !== 'archived') {
        if (await archive(row, row.output_url)) summary.archived += 1;
        else summary.errors += 1;
        continue;
      }
      if (!row.provider_job_id) { await unlock(row.id); continue; }
      const job = await fetchProviderJob(row.provider_job_id);
      const age = Date.now() - new Date(row.created_at).getTime();
      if (job.status === 'failed') {
        await refundGeneration(row.id, job.error || 'Provider báo thất bại.');
        summary.failed += 1;
      } else if (job.status === 'completed' && job.videoUrl) {
        await markSucceeded(row.id, job.rawStatus, job.videoUrl, job.mediaGenerationId);
        summary.completed += 1;
        if (await archive(row, job.videoUrl)) summary.archived += 1;
      } else if (age > 6 * 60 * 60 * 1000) {
        await refundGeneration(row.id, 'Job vượt quá thời gian xử lý tối đa 6 giờ.');
        summary.failed += 1;
      } else await unlock(row.id);
    } catch {
      summary.errors += 1;
      await unlock(row.id).catch(() => undefined);
    }
  }

  const expired = await callAdminRpc('claim_expired_storage_batch', { p_limit: 20 }) as Array<Record<string, any>> || [];
  for (const item of expired) {
    try {
      await removeStoredVideo(item.storage_bucket, item.storage_path);
      const table = item.record_type === 'output' ? 'video_outputs' : 'generations';
      await adminRequest(`${table}?id=eq.${encodeURIComponent(item.id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(table === 'video_outputs'
          ? { status: 'expired', storage_path: null, storage_deleted_at: new Date().toISOString() }
          : { storage_status: 'deleted', storage_path: null, output_url: null, storage_deleted_at: new Date().toISOString(), reconcile_locked_until: null })
      });
      summary.deleted += 1;
    } catch { summary.errors += 1; }
  }
  return NextResponse.json({ ok: true, summary });
}
