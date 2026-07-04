import { NextRequest, NextResponse } from 'next/server';
import { failAndRefundGeneration, markGenerationSucceeded } from '../../../../lib/saas/database';
import {
  claimExpiredStorageBatch,
  claimGenerationReconciliationBatch,
  markGenerationArchived,
  markGenerationArchiveFailed,
  markGenerationStorageDeleted,
  releaseReconciliationLock
} from '../../../../lib/saas/database-storage';
import { downloadRemoteVideo, removeStoredVideo, uploadStoredVideo } from '../../../../lib/saas/storage-client';
import { fetchUseApiJob } from '../../../../lib/useapi/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

async function archiveGeneration(row: Record<string, any>, providerUrl: string) {
  try {
    const path = `${row.user_id}/${row.id}/scene.mp4`;
    const buffer = await downloadRemoteVideo(providerUrl);
    const stored = await uploadStoredVideo(path, buffer);
    await markGenerationArchived({ generationId: row.id, ...stored });
    return 'archived';
  } catch (error) {
    await markGenerationArchiveFailed(row.id, error instanceof Error ? error.message : 'Archive thất bại.');
    return 'archive_failed';
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false }, { status: 401 });

  const summary = { checked: 0, completed: 0, failed: 0, archived: 0, deleted: 0, errors: 0 };
  const rows = await claimGenerationReconciliationBatch(15);

  for (const row of rows) {
    summary.checked += 1;
    try {
      if (row.status === 'reserved' && !row.provider_job_id) {
        await failAndRefundGeneration(row.id, 'Yêu cầu tạo video bị treo trước khi gửi provider.');
        summary.failed += 1;
        continue;
      }

      if (row.status === 'succeeded' && row.output_url && row.storage_status !== 'archived') {
        const result = await archiveGeneration(row, row.output_url);
        if (result === 'archived') summary.archived += 1;
        else summary.errors += 1;
        continue;
      }

      if (!row.provider_job_id) {
        await releaseReconciliationLock(row.id);
        continue;
      }

      const ageMs = Date.now() - new Date(row.created_at).getTime();
      const job = await fetchUseApiJob(row.provider_job_id);
      if (job.normalizedStatus === 'failed') {
        await failAndRefundGeneration(row.id, job.error || 'Provider báo tạo video thất bại.');
        summary.failed += 1;
      } else if (job.normalizedStatus === 'completed' && job.videoUrl) {
        await markGenerationSucceeded({
          generationId: row.id,
          providerStatus: job.rawStatus,
          videoUrl: job.videoUrl,
          providerAssetId: job.mediaGenerationId
        });
        summary.completed += 1;
        const result = await archiveGeneration(row, job.videoUrl);
        if (result === 'archived') summary.archived += 1;
        else summary.errors += 1;
      } else if (ageMs > 6 * 60 * 60 * 1000) {
        await failAndRefundGeneration(row.id, 'Job provider vượt quá thời gian xử lý tối đa 6 giờ.');
        summary.failed += 1;
      } else {
        await releaseReconciliationLock(row.id);
      }
    } catch {
      summary.errors += 1;
      await releaseReconciliationLock(row.id).catch(() => undefined);
    }
  }

  const expired = await claimExpiredStorageBatch(10);
  for (const item of expired) {
    try {
      await removeStoredVideo(item.storage_bucket, item.storage_path);
      await markGenerationStorageDeleted(item.id);
      summary.deleted += 1;
    } catch {
      summary.errors += 1;
      await releaseReconciliationLock(item.id).catch(() => undefined);
    }
  }

  return NextResponse.json({ ok: true, summary });
}
