import { NextRequest, NextResponse } from 'next/server';
import { authenticationErrorResponse, requireApiUser } from '../../../lib/saas/auth';
import {
  failAndRefundGeneration,
  getGenerationForUser,
  markGenerationProcessing,
  markGenerationSucceeded
} from '../../../lib/saas/database';
import { markGenerationArchived, markGenerationArchiveFailed } from '../../../lib/saas/database-storage';
import {
  createSignedVideoUrl,
  downloadRemoteVideo,
  uploadStoredVideo
} from '../../../lib/saas/storage-client';
import { fetchUseApiJob } from '../../../lib/useapi/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function archiveAndSign(input: {
  generationId: string;
  userId: string;
  providerUrl: string;
}) {
  const path = `${input.userId}/${input.generationId}/scene.mp4`;
  const buffer = await downloadRemoteVideo(input.providerUrl);
  const stored = await uploadStoredVideo(path, buffer);
  await markGenerationArchived({ generationId: input.generationId, ...stored });
  return createSignedVideoUrl(stored.bucket, stored.path, 3600);
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireApiUser(request);
    const jobId = request.nextUrl.searchParams.get('jobId')?.trim();
    if (!jobId) return NextResponse.json({ ok: false, error: 'Thiếu jobId.' }, { status: 400 });

    const generation = await getGenerationForUser(user.id, jobId);
    if (!generation) {
      return NextResponse.json({ ok: false, error: 'Job không tồn tại hoặc không thuộc tài khoản này.' }, { status: 404 });
    }

    if (generation.status === 'succeeded' && generation.storage_status === 'archived' && generation.storage_bucket && generation.storage_path) {
      const videoUrl = await createSignedVideoUrl(generation.storage_bucket, generation.storage_path, 3600);
      return NextResponse.json({ ok: true, status: 'completed', videoUrl, mediaGenerationId: generation.provider_asset_id || '', error: '' });
    }

    const job = await fetchUseApiJob(jobId);
    if (job.normalizedStatus === 'failed') {
      const message = job.error || 'Tạo video thất bại.';
      await failAndRefundGeneration(generation.id, message);
      return NextResponse.json({ ok: true, status: 'failed', videoUrl: '', mediaGenerationId: '', error: message });
    }

    if (job.normalizedStatus === 'completed') {
      if (!job.videoUrl) {
        return NextResponse.json({ ok: true, status: 'processing', videoUrl: '', mediaGenerationId: job.mediaGenerationId, error: 'Video chưa sẵn sàng.' });
      }

      await markGenerationSucceeded({
        generationId: generation.id,
        providerStatus: job.rawStatus,
        videoUrl: job.videoUrl,
        providerAssetId: job.mediaGenerationId
      });

      let videoUrl = job.videoUrl;
      try {
        videoUrl = await archiveAndSign({ generationId: generation.id, userId: user.id, providerUrl: job.videoUrl });
      } catch (error) {
        await markGenerationArchiveFailed(generation.id, error instanceof Error ? error.message : 'Archive thất bại.').catch(() => undefined);
      }

      return NextResponse.json({ ok: true, status: 'completed', videoUrl, mediaGenerationId: job.mediaGenerationId, error: '' });
    }

    await markGenerationProcessing(generation.id, job.rawStatus);
    return NextResponse.json({
      ok: true,
      status: job.normalizedStatus,
      videoUrl: '',
      mediaGenerationId: job.mediaGenerationId,
      error: job.error
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') return authenticationErrorResponse(error);
    const status = Number((error as { status?: number })?.status || 500);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Lỗi kiểm tra job.', retryAfter: status === 429 ? 10 : undefined },
      { status }
    );
  }
}
