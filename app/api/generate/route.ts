import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const USEAPI_ROOT = 'https://api.useapi.net/v1/google-flow';
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function jsonError(message: string, status = 400, raw?: unknown) {
  return NextResponse.json({ ok: false, message, raw }, { status });
}

function getEnv() {
  const token = process.env.USEAPI_TOKEN?.trim();
  const email = process.env.USEAPI_EMAIL?.trim();

  if (!token) {
    throw new Error('Thiếu USEAPI_TOKEN trong Environment Variables.');
  }

  return { token, email };
}

function extractMediaGenerationId(uploadResult: Record<string, any>) {
  const value = uploadResult?.mediaGenerationId;
  if (typeof value === 'string') return value;
  if (typeof value?.mediaGenerationId === 'string') return value.mediaGenerationId;
  return '';
}

function extractJobId(videoResult: Record<string, any>) {
  if (typeof videoResult?.jobid === 'string') return videoResult.jobid;
  if (typeof videoResult?.jobId === 'string') return videoResult.jobId;
  return '';
}

function buildVideoPrompt(script: string) {
  return [
    'Create a realistic 8-second vertical portrait video from the uploaded start image.',
    'The person in the start image speaks naturally in Vietnamese.',
    'Keep the same face, identity, age, hairstyle, outfit, skin tone and overall appearance as the start image.',
    'Natural lip movement, friendly professional expression, stable camera, clean lighting.',
    'Do not add text overlay, captions, watermark, logo, distorted face or extra people.',
    'Vietnamese Northern accent if speech is generated. Do not mix accents.',
    `Script/content: ${script.trim()}`
  ].join(' ');
}

export async function POST(request: NextRequest) {
  try {
    const { token, email } = getEnv();
    const formData = await request.formData();

    const image = formData.get('image');
    const script = String(formData.get('script') || '').trim();
    const requestedModel = String(formData.get('model') || 'veo-3.1-lite').trim();
    const model = ['veo-3.1-fast', 'veo-3.1-lite', 'veo-3.1-quality'].includes(requestedModel)
      ? requestedModel
      : 'veo-3.1-lite';

    if (!image || typeof image === 'string') {
      return jsonError('Vui lòng upload 1 ảnh nhân vật.');
    }

    if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
      return jsonError('Ảnh phải là PNG, JPG hoặc WEBP.');
    }

    if (image.size > MAX_IMAGE_SIZE) {
      return jsonError('Ảnh vượt quá 4MB. Vui lòng nén ảnh nhẹ hơn rồi thử lại.');
    }

    if (!script) {
      return jsonError('Vui lòng nhập nội dung/lời thoại.');
    }

    const uploadUrl = email
      ? `${USEAPI_ROOT}/assets/${encodeURIComponent(email)}`
      : `${USEAPI_ROOT}/assets`;

    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': image.type
      },
      body: imageBuffer
    });

    const uploadText = await uploadResponse.text();
    let uploadResult: any;
    try {
      uploadResult = JSON.parse(uploadText);
    } catch {
      uploadResult = { rawText: uploadText };
    }

    if (!uploadResponse.ok) {
      return jsonError(`Upload ảnh lỗi HTTP ${uploadResponse.status}.`, uploadResponse.status, uploadResult);
    }

    const mediaGenerationId = extractMediaGenerationId(uploadResult);
    if (!mediaGenerationId) {
      return jsonError('Upload ảnh thành công nhưng không lấy được mediaGenerationId.', 502, uploadResult);
    }

    const videoPayload: Record<string, unknown> = {
      email: email || undefined,
      prompt: buildVideoPrompt(script),
      model,
      aspectRatio: 'portrait',
      duration: 8,
      count: 1,
      startImage: mediaGenerationId,
      async: true,
      captchaRetry: 5
    };

    const videoResponse = await fetch(`${USEAPI_ROOT}/videos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(videoPayload)
    });

    const videoText = await videoResponse.text();
    let videoResult: any;
    try {
      videoResult = JSON.parse(videoText);
    } catch {
      videoResult = { rawText: videoText };
    }

    if (!videoResponse.ok) {
      return jsonError(`Tạo video lỗi HTTP ${videoResponse.status}.`, videoResponse.status, videoResult);
    }

    const jobId = extractJobId(videoResult);
    if (!jobId) {
      return jsonError('UseAPI đã phản hồi nhưng không thấy jobId/jobid.', 502, videoResult);
    }

    return NextResponse.json({
      ok: true,
      jobId,
      mediaGenerationId,
      raw: videoResult
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Lỗi server không xác định.', 500);
  }
}
