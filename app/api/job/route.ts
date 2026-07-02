import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const USEAPI_ROOT = 'https://api.useapi.net/v1/google-flow';

function getVideoFromJob(job: any) {
  const media = job?.response?.media || job?.media || [];
  if (!Array.isArray(media) || media.length === 0) return { videoUrl: '', mediaGenerationId: '' };

  const firstWithUrl = media.find((item) => typeof item?.videoUrl === 'string') || media[0];
  return {
    videoUrl: typeof firstWithUrl?.videoUrl === 'string' ? firstWithUrl.videoUrl : '',
    mediaGenerationId: typeof firstWithUrl?.mediaGenerationId === 'string' ? firstWithUrl.mediaGenerationId : ''
  };
}

function getDetailedJobError(job: any) {
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

export async function GET(request: NextRequest) {
  const token = process.env.USEAPI_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Thiếu USEAPI_TOKEN trong Environment Variables.' }, { status: 500 });
  }

  const jobId = request.nextUrl.searchParams.get('jobId')?.trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: 'Thiếu jobId.' }, { status: 400 });
  }

  const response = await fetch(`${USEAPI_ROOT}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });

  const text = await response.text();
  let job: any;
  try {
    job = JSON.parse(text);
  } catch {
    job = { rawText: text };
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Kiểm tra job lỗi HTTP ${response.status}: ${job?.error || job?.message || 'Không rõ lỗi.'}`,
        raw: job
      },
      { status: response.status }
    );
  }

  const { videoUrl, mediaGenerationId } = getVideoFromJob(job);
  const detailedError = getDetailedJobError(job);

  return NextResponse.json({
    ok: true,
    status: job.status || 'unknown',
    videoUrl,
    mediaGenerationId,
    error: detailedError,
    raw: job
  });
}
