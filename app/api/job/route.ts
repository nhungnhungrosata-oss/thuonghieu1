import { NextRequest, NextResponse } from 'next/server';
import { authenticationErrorResponse, requireApiUser } from '../../../lib/saas/auth';
import {
  getGenerationByJob,
  getOwnedRecord,
  linkGenerationProviderJob,
  markArchiveFailed,
  markArchived,
  markProcessing,
  markSucceeded,
  refundGeneration
} from '../../../lib/saas/db';
import { createSignedVideoUrl, downloadRemoteVideo, uploadVideo } from '../../../lib/saas/storage';
import { verifyJobRecoveryToken } from '../../../lib/saas/recovery';
import { fetchProviderJob } from '../../../lib/useapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function archive(generationId: string, userId: string, url: string) {
  const buffer = await downloadRemoteVideo(url);
  const stored = await uploadVideo(`${userId}/scenes/${generationId}.mp4`, buffer);
  await markArchived(generationId, stored);
  return createSignedVideoUrl(stored.bucket, stored.path, 3600);
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireApiUser(request);
    const jobId = request.nextUrl.searchParams.get('jobId')?.trim();
    const generationId = request.nextUrl.searchParams.get('generationId')?.trim();
    const recoveryToken = request.nextUrl.searchParams.get('recoveryToken')?.trim() || '';
    if (!jobId) return NextResponse.json({ ok: false, error: 'Thiếu jobId.' }, { status: 400 });

    let generation = await getGenerationByJob(user.id, jobId);
    if (!generation && generationId && recoveryToken) {
      const tokenValid = verifyJobRecoveryToken(recoveryToken, { userId: user.id, generationId, jobId });
      if (tokenValid) {
        const recovered = await getOwnedRecord('generations', user.id, generationId);
        if (recovered && (!recovered.provider_job_id || recovered.provider_job_id === jobId)) {
          if (!recovered.provider_job_id) await linkGenerationProviderJob(recovered.id, jobId);
          generation = { ...recovered, provider_job_id: jobId } as typeof generation;
        }
      }
    }
    if (!generation) {
      return NextResponse.json({ ok: false, error: 'Job không tồn tại hoặc không thuộc tài khoản này.' }, { status: 404 });
    }

    if (generation.status === 'succeeded' && generation.storage_status === 'archived' && generation.storage_bucket && generation.storage_path) {
      const videoUrl = await createSignedVideoUrl(generation.storage_bucket, generation.storage_path, 3600);
      return NextResponse.json({ ok: true, status: 'completed', generationId: generation.id, videoUrl, error: '' });
    }

    const job = await fetchProviderJob(jobId);
    if (job.status === 'failed') {
      const message = job.error || 'Provider báo tạo video thất bại.';
      await refundGeneration(generation.id, message);
      return NextResponse.json({ ok: true, status: 'failed', generationId: generation.id, videoUrl: '', error: message });
    }

    if (job.status === 'completed') {
      if (!job.videoUrl) {
        return NextResponse.json({ ok: true, status: 'processing', generationId: generation.id, videoUrl: '', error: 'File video chưa sẵn sàng.' });
      }
      await markSucceeded(generation.id, job.rawStatus, job.videoUrl, job.mediaGenerationId);
      let videoUrl = job.videoUrl;
      try {
        videoUrl = await archive(generation.id, user.id, job.videoUrl);
      } catch (error) {
        await markArchiveFailed(generation.id, error instanceof Error ? error.message : 'Lưu video thất bại.').catch(() => undefined);
      }
      return NextResponse.json({ ok: true, status: 'completed', generationId: generation.id, videoUrl, error: '' });
    }

    await markProcessing(generation.id, job.rawStatus);
    return NextResponse.json({ ok: true, status: job.status, generationId: generation.id, videoUrl: '', error: job.error });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') return authenticationErrorResponse(error);
    const status = Number((error as { status?: number })?.status || 500);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Không kiểm tra được job.', retryAfter: status === 429 ? 10 : undefined },
      { status }
    );
  }
}
