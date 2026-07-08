import { getUseApiConfig } from './saas/config';

const ROOT = 'https://api.useapi.net/v1/google-flow';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type ProviderJob = {
  rawStatus: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl: string;
  mediaGenerationId: string;
  error: string;
};

async function json(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  try { return JSON.parse(text) as Record<string, any>; }
  catch { return { message: text }; }
}

async function timedFetch(url: string, init: RequestInit, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' }); }
  finally { clearTimeout(timer); }
}

export function validateImage(image: File) {
  if (!IMAGE_TYPES.has(image.type)) throw new Error('Ảnh phải là PNG, JPG hoặc WEBP.');
  if (!image.size || image.size > MAX_IMAGE_BYTES) throw new Error('Ảnh phải nhỏ hơn hoặc bằng 4MB.');
}

export async function submitProviderVideo(input: {
  image: File;
  prompt: string;
  aspectRatio: 'portrait' | 'landscape';
  model?: string;
}) {
  const { token, email } = getUseApiConfig();
  validateImage(input.image);
  const imageBuffer = Buffer.from(await input.image.arrayBuffer());
  const uploadPath = email
    ? `${ROOT}/assets/${encodeURIComponent(email)}`
    : `${ROOT}/assets`;

  const uploadResponse = await timedFetch(uploadPath, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': input.image.type },
    body: new Uint8Array(imageBuffer)
  });
  const upload = await json(uploadResponse);
  if (!uploadResponse.ok) {
    throw Object.assign(new Error(String(upload.message || `Upload ảnh lỗi HTTP ${uploadResponse.status}.`)), {
      status: uploadResponse.status
    });
  }

  const mediaGenerationId = typeof upload.mediaGenerationId === 'string'
    ? upload.mediaGenerationId
    : String(upload.mediaGenerationId?.mediaGenerationId || '');
  if (!mediaGenerationId) throw new Error('Provider không trả mediaGenerationId cho ảnh.');

  const videoResponse = await timedFetch(`${ROOT}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email || undefined,
      prompt: input.prompt,
      model: input.model || 'veo-3.1-lite-low-priority',
      aspectRatio: input.aspectRatio,
      duration: 8,
      count: 1,
      startImage: mediaGenerationId,
      async: true,
      captchaRetry: 5
    })
  });
  const video = await json(videoResponse);
  if (!videoResponse.ok) {
    throw Object.assign(new Error(String(video.message || video.error || `Tạo video lỗi HTTP ${videoResponse.status}.`)), {
      status: videoResponse.status
    });
  }
  const jobId = String(video.jobid || video.jobId || '');
  if (!jobId) throw new Error('Provider không trả jobId.');
  return { jobId, mediaGenerationId };
}

export async function fetchProviderJob(jobId: string): Promise<ProviderJob> {
  const { token } = getUseApiConfig();
  const response = await timedFetch(`${ROOT}/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  }, 25_000);
  const job = await json(response);
  if (!response.ok) {
    throw Object.assign(new Error(String(job.message || job.error || `Kiểm tra job lỗi HTTP ${response.status}.`)), {
      status: response.status
    });
  }

  const rawStatus = String(job.status || 'unknown');
  const normalized = rawStatus.toLowerCase();
  const status: ProviderJob['status'] = normalized === 'completed'
    ? 'completed'
    : normalized === 'failed'
      ? 'failed'
      : normalized === 'created' || normalized === 'pending'
        ? 'pending'
        : 'processing';

  const media = Array.isArray(job.response?.media)
    ? job.response.media
    : Array.isArray(job.media) ? job.media : [];
  const result = media.find((item: any) => typeof item?.videoUrl === 'string') || media[0] || {};
  const errors = [
    job.error,
    job.errorDetails,
    job.response?.message,
    job.response?.error?.message,
    result.error,
    result.errorDetails,
    result.mediaMetadata?.mediaStatus?.error?.message
  ].filter((value) => typeof value === 'string' && value.trim());

  return {
    rawStatus,
    status,
    videoUrl: typeof result.videoUrl === 'string' ? result.videoUrl : '',
    mediaGenerationId: typeof result.mediaGenerationId === 'string' ? result.mediaGenerationId : '',
    error: Array.from(new Set(errors)).join(' | ')
  };
}
