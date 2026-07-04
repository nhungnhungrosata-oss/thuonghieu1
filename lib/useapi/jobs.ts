const USEAPI_ROOT = 'https://api.useapi.net/v1/google-flow';

export type UseApiJobSnapshot = {
  rawStatus: string;
  normalizedStatus: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl: string;
  mediaGenerationId: string;
  error: string;
};

export async function fetchUseApiJob(jobId: string): Promise<UseApiJobSnapshot> {
  const token = process.env.USEAPI_TOKEN?.trim();
  if (!token) throw new Error('Thiếu USEAPI_TOKEN trong Environment Variables.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${USEAPI_ROOT}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await response.text();
    let job: Record<string, any>;
    try {
      job = JSON.parse(text) as Record<string, any>;
    } catch {
      job = { message: text };
    }

    if (!response.ok) {
      const error = new Error(response.status === 429
        ? 'Dịch vụ đang giới hạn tần suất kiểm tra.'
        : `Kiểm tra job lỗi HTTP ${response.status}.`);
      Object.assign(error, { status: response.status });
      throw error;
    }

    const rawStatus = typeof job.status === 'string' ? job.status : 'unknown';
    const status = rawStatus.toLowerCase();
    const normalizedStatus: UseApiJobSnapshot['normalizedStatus'] = status === 'completed'
      ? 'completed'
      : status === 'failed'
        ? 'failed'
        : status === 'created' || status === 'pending'
          ? 'pending'
          : 'processing';

    const media = job?.response?.media || job?.media || [];
    const item = Array.isArray(media)
      ? media.find((entry) => typeof entry?.videoUrl === 'string') || media[0]
      : null;

    return {
      rawStatus,
      normalizedStatus,
      videoUrl: typeof item?.videoUrl === 'string' ? item.videoUrl : '',
      mediaGenerationId: typeof item?.mediaGenerationId === 'string' ? item.mediaGenerationId : '',
      error: String(job?.error || job?.response?.message || '')
    };
  } finally {
    clearTimeout(timeout);
  }
}
