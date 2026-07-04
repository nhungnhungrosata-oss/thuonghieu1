import { NextRequest, NextResponse } from 'next/server';
import { authenticationErrorResponse, requireApiUser } from '../../../lib/saas/auth';
import {
  failAndRefundGeneration,
  getGenerationForUser,
  markGenerationProcessing,
  markGenerationSucceeded
} from '../../../lib/saas/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const USEAPI_ROOT = 'https://api.useapi.net/v1/google-flow';
const REQUEST_TIMEOUT_MS = 25_000;

function getVideoFromJob(job: Record<string, any>) {
  const media = job?.response?.media || job?.media || [];
  if (!Array.isArray(media) || media.length === 0) return { videoUrl: '', mediaGenerationId: '' };

  const firstWithUrl = media.find((item) => typeof item?.videoUrl === 'string') || media[0];
  return {
    videoUrl: typeof firstWithUrl?.videoUrl === 'string' ? firstWithUrl.videoUrl : '',
    mediaGenerationId: typeof firstWithUrl?.mediaGenerationId === 'string' ? firstWithUrl.mediaGenerationId : ''
  };
}

function getDetailedJobError(job: Record<string, any>) {
  const messages = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) messages.add(value.trim());
  };

  add(job?.error);
  add(job?.errorDetails);
  add(job?.response?.error?.message);
  add(job?.response?.error?.status);
  add(job?.response?.message);

  const media = job?.response?.media || job?.media || [];
  if (Array.isArray(media)) {
    for (const item of media) {
      add(item?.error);
      add(item?.errorDetails);
      add(item?.mediaMetadata?.mediaStatus?.error?.message);
      add(item?.mediaMetadata?.mediaStatus?.error?.code ? `Google Flow error code: ${item.mediaMetadata.mediaStatus.error.code}` : '');
      add(item?.mediaMetadata?.mediaStatus?.mediaGenerationStatus);
    }
  }

  const attempts = job?.response?.captcha?.attempts;
  if (Array.isArray(attempts)) {
    for (const attempt of attempts) add(attempt?.error);
  }

  return Array.from(messages).join(' | ');
}

async function fetchJob(token: string, jobId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${USEAPI_ROOT}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireApiUser(request);
    const token = process.env.USEAPI_TOKEN?.trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Thiếu USEAPI_TOKEN trong Environment Variables.' }, { status: 500 });
    }

    const jobId = request.nextUrl.searchParams.get('jobId')?.trim();
    if (!jobId) return NextResponse.json({ ok: false, error: 'Thiếu jobId.' }, { status: 400 });

    const generation = await getGenerationForUser(user.id, jobId);
    if (!generation) {
      return NextResponse.json({ ok: false, error: 'Job không tồn tại hoặc không thuộc tài khoản này.' }, { status: 404 });
    }

    const response = await fetchJob(token, jobId);
    const text = await response.text();
    let job: Record<string, any>;
    try {
      job = JSON.parse(text) as Record<string, any>;
    } catch {
      job = { message: text };
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: response.status === 429
            ? 'Dịch vụ đang giới hạn tần suất kiểm tra. Hệ thống sẽ thử lại.'
            : `Kiểm tra job lỗi HTTP ${response.status}: ${job?.error || job?.message || 'Không rõ lỗi.'}`,
          retryAfter: response.status === 429 ? 10 : undefined
        },
        { status: response.status }
      );
    }

    const providerStatus = typeof job.status === 'string' ? job.status : 'unknown';
    const normalizedStatus = providerStatus.toLowerCase();
    const { videoUrl, mediaGenerationId } = getVideoFromJob(job);
    const detailedError = getDetailedJobError(job);

    if (normalizedStatus === 'failed') {
      const message = detailedError || 'Tạo video thất bại.';
      await failAndRefundGeneration(generation.id, message);
      return NextResponse.json({
        ok: true,
        status: 'failed',
        videoUrl: '',
        mediaGenerationId: '',
        error: message
      });
    }

    if (normalizedStatus === 'completed') {
      if (!videoUrl) {
        return NextResponse.json({
          ok: true,
          status: 'processing',
          videoUrl: '',
          mediaGenerationId,
          error: 'Provider báo hoàn thành nhưng file video chưa sẵn sàng.'
        });
      }

      await markGenerationSucceeded({
        generationId: generation.id,
        providerStatus,
        videoUrl,
        providerAssetId: mediaGenerationId
      });

      return NextResponse.json({
        ok: true,
        status: 'completed',
        videoUrl,
        mediaGenerationId,
        error: ''
      });
    }

    await markGenerationProcessing(generation.id, providerStatus);
    return NextResponse.json({
      ok: true,
      status: normalizedStatus === 'created' ? 'pending' : 'processing',
      videoUrl: '',
      mediaGenerationId,
      error: detailedError
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') {
      return authenticationErrorResponse(error);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ ok: false, error: 'Kiểm tra job quá thời gian.', retryAfter: 10 }, { status: 504 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Lỗi kiểm tra job không xác định.' },
      { status: 500 }
    );
  }
}
