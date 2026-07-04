import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isVideoEmotion, isVideoRegion, type VideoEmotion, type VideoRegion } from '../../../lib/video-script';
import { authenticationErrorResponse, requireApiUser } from '../../../lib/saas/auth';
import {
  failAndRefundGeneration,
  markGenerationSubmitted,
  reserveVideoGeneration
} from '../../../lib/saas/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const USEAPI_ROOT = 'https://api.useapi.net/v1/google-flow';
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const REQUEST_TIMEOUT_MS = 90_000;
const IDEMPOTENCY_WINDOW_MS = 15 * 60 * 1000;

type FlowAspectRatio = 'portrait' | 'landscape';

function jsonError(message: string, status = 400, retryAfter?: number) {
  const response = NextResponse.json({ ok: false, message, retryAfter }, { status });
  if (retryAfter) response.headers.set('Retry-After', String(retryAfter));
  return response;
}

function getEnv() {
  const token = process.env.USEAPI_TOKEN?.trim();
  const email = process.env.USEAPI_EMAIL?.trim();
  if (!token) throw new Error('Thiếu USEAPI_TOKEN trong Environment Variables.');
  return { token, email };
}

function extractMediaGenerationId(uploadResult: Record<string, unknown>) {
  const value = uploadResult?.mediaGenerationId;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).mediaGenerationId === 'string') {
    return String((value as Record<string, unknown>).mediaGenerationId);
  }
  return '';
}

function extractJobId(videoResult: Record<string, unknown>) {
  if (typeof videoResult?.jobid === 'string') return videoResult.jobid;
  if (typeof videoResult?.jobId === 'string') return videoResult.jobId;
  return '';
}

function resolveFlowAspectRatio(formValue: FormDataEntryValue | null, script: string): FlowAspectRatio {
  const requested = typeof formValue === 'string' ? formValue.trim().toLowerCase() : '';
  if (requested === '16:9' || requested === 'landscape') return 'landscape';
  if (requested === '9:16' || requested === 'portrait') return 'portrait';

  const normalizedScript = script.toLowerCase();
  if (
    normalizedScript.includes('tỷ lệ bố cục mong muốn: 16:9') ||
    normalizedScript.includes('tỷ lệ 16:9') ||
    normalizedScript.includes('khung hình 16:9')
  ) return 'landscape';

  return 'portrait';
}

function readVideoRegion(formValue: FormDataEntryValue | null): VideoRegion | null {
  const value = typeof formValue === 'string' ? formValue.trim() : '';
  return isVideoRegion(value) ? value : null;
}

function readVideoEmotion(formValue: FormDataEntryValue | null): VideoEmotion | null {
  const value = typeof formValue === 'string' ? formValue.trim() : '';
  return isVideoEmotion(value) ? value : null;
}

function buildVideoPrompt(
  script: string,
  aspectRatio: FlowAspectRatio,
  region: VideoRegion | null,
  emotion: VideoEmotion | null
) {
  const formatInstruction = aspectRatio === 'landscape'
    ? 'Create a realistic 8-second horizontal landscape video in true 16:9 composition from the uploaded start image. Fill the entire 16:9 frame naturally; do not place a vertical video inside a horizontal canvas and do not add black bars.'
    : 'Create a realistic 8-second vertical portrait video in true 9:16 composition from the uploaded start image. Fill the entire 9:16 frame naturally; do not add black bars.';

  const fixedSelectionInstructions = [
    `FIXED OUTPUT FORMAT (do not deviate): aspect ratio must be exactly ${aspectRatio === 'landscape' ? '16:9 landscape' : '9:16 portrait'}, filling the whole frame with no letterboxing and no black bars on any side.`,
    region
      ? `FIXED VOICE (do not deviate, must stay identical across every scene of this video): the character must speak with a consistent Vietnamese "${region}" regional accent from the very first word to the last. Never switch, blend or drift into a different Vietnamese accent.`
      : '',
    emotion
      ? `FIXED EXPRESSION (do not deviate): the character's dominant facial expression and tone must match "${emotion}" throughout the whole 8 seconds.`
      : ''
  ].filter(Boolean).join(' ');

  return [
    formatInstruction,
    fixedSelectionInstructions,
    'The person in the start image speaks naturally in Vietnamese.',
    'Keep the same face, identity, age, hairstyle, outfit, skin tone and overall appearance as the start image.',
    'Keep the same main background and environment. Extend the background naturally only as needed to fill the selected frame.',
    'Natural lip movement, stable camera, clean lighting.',
    'Do not add text overlay, captions, watermark, logo, distorted face or extra people.',
    'Do not mix accents; ignore any conflicting accent or aspect-ratio wording below and always follow the FIXED instructions above instead.',
    `Script/content: ${script.trim()}`
  ].filter(Boolean).join(' ');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text || `HTTP ${response.status}` };
  }
}

function reservationError(reason: string) {
  if (reason === 'no_credits') return jsonError('Bạn đã hết credit tạo video. Vui lòng nâng gói hoặc nạp thêm credit.', 402);
  if (reason === 'user_busy') return jsonError('Tài khoản đang có quá nhiều cảnh xử lý cùng lúc. Hãy chờ cảnh hiện tại hoàn thành.', 429, 20);
  if (reason === 'hourly_limit') return jsonError('Bạn đã đạt giới hạn tạo cảnh trong giờ này. Vui lòng thử lại sau.', 429, 300);
  if (reason === 'system_busy') return jsonError('Hệ thống đang có nhiều video xử lý. Vui lòng thử lại sau ít phút.', 429, 30);
  return jsonError('Không thể giữ lượt tạo video lúc này.', 503, 15);
}

export async function POST(request: NextRequest) {
  let reservationId = '';
  let providerJobCreated = false;

  try {
    const { user, accessToken } = await requireApiUser(request);
    const { token, email } = getEnv();
    const formData = await request.formData();

    const image = formData.get('image');
    const script = String(formData.get('script') || '').trim();
    const requestedModel = String(formData.get('model') || 'veo-3.1-lite').trim();
    const model = ['veo-3.1-fast', 'veo-3.1-lite', 'veo-3.1-quality'].includes(requestedModel)
      ? requestedModel
      : 'veo-3.1-lite';
    const aspectRatio = resolveFlowAspectRatio(formData.get('aspectRatio'), script);
    const region = readVideoRegion(formData.get('region'));
    const emotion = readVideoEmotion(formData.get('emotion'));

    if (!image || typeof image === 'string') return jsonError('Vui lòng upload 1 ảnh nhân vật.');
    if (!ALLOWED_IMAGE_TYPES.has(image.type)) return jsonError('Ảnh phải là PNG, JPG hoặc WEBP.');
    if (image.size > MAX_IMAGE_SIZE) return jsonError('Ảnh vượt quá 4MB. Vui lòng nén ảnh nhẹ hơn rồi thử lại.');
    if (!script) return jsonError('Vui lòng nhập nội dung/lời thoại.');

    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const timeBucket = Math.floor(Date.now() / IDEMPOTENCY_WINDOW_MS);
    const idempotencyKey = createHash('sha256')
      .update(user.id)
      .update(script)
      .update(model)
      .update(aspectRatio)
      .update(String(timeBucket))
      .update(imageBuffer)
      .digest('hex');

    const reservation = await reserveVideoGeneration({
      accessToken,
      idempotencyKey,
      prompt: script,
      model,
      costCredits: 1
    });

    if (!reservation.allowed) return reservationError(reservation.reason);
    reservationId = reservation.generationId;

    if (reservation.reused) {
      if (reservation.providerJobId) {
        return NextResponse.json({
          ok: true,
          jobId: reservation.providerJobId,
          generationId: reservation.generationId,
          reused: true
        });
      }
      return jsonError('Yêu cầu giống hệt đang được gửi. Vui lòng chờ vài giây rồi thử lại.', 409, 5);
    }

    const uploadUrl = email
      ? `${USEAPI_ROOT}/assets/${encodeURIComponent(email)}`
      : `${USEAPI_ROOT}/assets`;

    const uploadResponse = await fetchWithTimeout(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': image.type
      },
      body: imageBuffer
    });
    const uploadResult = await readJsonResponse(uploadResponse);

    if (!uploadResponse.ok) {
      const message = `Upload ảnh lỗi HTTP ${uploadResponse.status}.`;
      await failAndRefundGeneration(reservationId, message);
      reservationId = '';
      return jsonError(message, uploadResponse.status === 429 ? 429 : 502, uploadResponse.status === 429 ? 30 : undefined);
    }

    const mediaGenerationId = extractMediaGenerationId(uploadResult);
    if (!mediaGenerationId) {
      await failAndRefundGeneration(reservationId, 'Upload ảnh thành công nhưng thiếu mediaGenerationId.');
      reservationId = '';
      return jsonError('Upload ảnh thành công nhưng không lấy được mediaGenerationId.', 502);
    }

    const videoPayload: Record<string, unknown> = {
      email: email || undefined,
      prompt: buildVideoPrompt(script, aspectRatio, region, emotion),
      model,
      aspectRatio,
      duration: 8,
      count: 1,
      startImage: mediaGenerationId,
      async: true,
      captchaRetry: 5
    };

    const videoResponse = await fetchWithTimeout(`${USEAPI_ROOT}/videos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(videoPayload)
    });
    const videoResult = await readJsonResponse(videoResponse);

    if (!videoResponse.ok) {
      const message = videoResponse.status === 429
        ? 'Google Flow đang quá tải hoặc chưa có tài khoản đủ điều kiện.'
        : `Tạo video lỗi HTTP ${videoResponse.status}.`;
      await failAndRefundGeneration(reservationId, message);
      reservationId = '';
      return jsonError(message, videoResponse.status === 429 ? 429 : 502, videoResponse.status === 429 ? 30 : undefined);
    }

    const jobId = extractJobId(videoResult);
    if (!jobId) {
      await failAndRefundGeneration(reservationId, 'Provider phản hồi nhưng không có jobId.');
      reservationId = '';
      return jsonError('UseAPI đã phản hồi nhưng không thấy jobId/jobid.', 502);
    }

    providerJobCreated = true;
    let lastDatabaseError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await markGenerationSubmitted({
          generationId: reservationId,
          providerJobId: jobId,
          providerAssetId: mediaGenerationId
        });
        lastDatabaseError = undefined;
        break;
      } catch (error) {
        lastDatabaseError = error;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    if (lastDatabaseError) throw lastDatabaseError;

    return NextResponse.json({
      ok: true,
      jobId,
      generationId: reservationId,
      mediaGenerationId,
      aspectRatio,
      region: region || undefined,
      emotion: emotion || undefined
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') {
      return authenticationErrorResponse(error);
    }

    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Kết nối dịch vụ tạo video quá thời gian.'
      : error instanceof Error
        ? error.message
        : 'Lỗi server không xác định.';

    if (reservationId && !providerJobCreated) {
      await failAndRefundGeneration(reservationId, message).catch(() => undefined);
    }
    return jsonError(message, 500);
  }
}
