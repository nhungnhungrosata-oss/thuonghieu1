import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin, authenticationErrorResponse, requireApiUser } from '../../../lib/saas/auth';
import { markSubmitted, refundGeneration, reserveGeneration } from '../../../lib/saas/db';
import { createJobRecoveryToken } from '../../../lib/saas/recovery';
import { submitProviderVideo } from '../../../lib/useapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

function fail(message: string, status = 400, retryAfter?: number) {
  const response = NextResponse.json({ ok: false, message, retryAfter }, { status });
  if (retryAfter) response.headers.set('Retry-After', String(retryAfter));
  return response;
}

function reservationFailure(reason: string) {
  if (reason === 'no_credits') return fail('Bạn đã hết credit.', 402);
  if (reason === 'user_busy') return fail('Tài khoản đang có quá nhiều cảnh xử lý đồng thời.', 429, 20);
  if (reason === 'hourly_limit') return fail('Bạn đã đạt giới hạn tạo cảnh trong giờ này.', 429, 300);
  if (reason === 'system_busy') return fail('Hệ thống đang bận. Vui lòng thử lại sau.', 429, 30);
  return fail('Không thể giữ lượt tạo video.', 503, 15);
}

async function persistSubmitted(generationId: string, jobId: string, assetId: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await markSubmitted(generationId, jobId, assetId);
      return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  console.error('Không lưu được provider job sau 3 lần thử:', lastError);
  return false;
}

export async function POST(request: NextRequest) {
  let generationId = '';
  let providerCreated = false;
  try {
    assertSameOrigin(request);
    const { user, accessToken } = await requireApiUser(request);
    const form = await request.formData();
    const image = form.get('image');
    const script = String(form.get('script') || '').trim();
    const requestedModel = String(form.get('model') || 'veo-3.1-lite-low-priority').trim();
    const aspectRatio = String(form.get('aspectRatio') || '9:16') === '16:9' ? 'landscape' : 'portrait';
    if (!(image instanceof File)) return fail('Vui lòng tải ảnh nhân vật.');
    if (!script || script.length > 12_000) return fail('Prompt video không hợp lệ.');

    const allowedModels = new Set([
      'veo-3.1-lite-low-priority',
      'veo-3.1-lite',
      'veo-3.1-fast',
      'veo-3.1-quality'
    ]);
    const model = allowedModels.has(requestedModel) ? requestedModel : 'veo-3.1-lite-low-priority';
    const imageBytes = Buffer.from(await image.arrayBuffer());
    const key = createHash('sha256')
      .update(user.id)
      .update(script)
      .update(model)
      .update(aspectRatio)
      .update(String(Math.floor(Date.now() / 900_000)))
      .update(imageBytes)
      .digest('hex');

    const reservation = await reserveGeneration({ accessToken, idempotencyKey: key, prompt: script, model });
    if (!reservation.allowed) return reservationFailure(reservation.reason);
    generationId = reservation.generationId;
    if (reservation.reused) {
      if (reservation.providerJobId) {
        return NextResponse.json({ ok: true, generationId, jobId: reservation.providerJobId, reused: true });
      }
      return fail('Yêu cầu giống hệt đang được gửi. Vui lòng chờ vài giây.', 409, 5);
    }

    const provider = await submitProviderVideo({ image, prompt: script, aspectRatio, model });
    providerCreated = true;
    const trackingSaved = await persistSubmitted(generationId, provider.jobId, provider.mediaGenerationId);
    const recoveryToken = createJobRecoveryToken({ userId: user.id, generationId, jobId: provider.jobId });

    return NextResponse.json({
      ok: true,
      generationId,
      jobId: provider.jobId,
      mediaGenerationId: provider.mediaGenerationId,
      model,
      modelDisplayName: model === 'veo-3.1-lite-low-priority' ? 'Veo 3.1 - lite [Lower Priority]' : model,
      trackingSaved,
      recoveryToken
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') return authenticationErrorResponse(error);
    const message = error instanceof Error ? error.message : 'Không thể tạo job video.';
    if (generationId && !providerCreated) await refundGeneration(generationId, message).catch(() => undefined);
    const providerStatus = Number((error as { status?: number })?.status || 0);
    return fail(message, providerStatus === 429 ? 429 : 500, providerStatus === 429 ? 30 : undefined);
  }
}
