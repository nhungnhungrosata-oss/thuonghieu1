import { NextRequest, NextResponse } from 'next/server';
import { isVideoEmotion, isVideoRegion, type VideoEmotion, type VideoRegion } from '../../../lib/video-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const USEAPI_ROOT = 'https://api.useapi.net/v1/google-flow';
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type FlowAspectRatio = 'portrait' | 'landscape';

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

function resolveFlowAspectRatio(formValue: FormDataEntryValue | null, script: string): FlowAspectRatio {
  const requested = typeof formValue === 'string' ? formValue.trim().toLowerCase() : '';

  if (requested === '16:9' || requested === 'landscape') return 'landscape';
  if (requested === '9:16' || requested === 'portrait') return 'portrait';

  const normalizedScript = script.toLowerCase();
  if (
    normalizedScript.includes('tỷ lệ bố cục mong muốn: 16:9') ||
    normalizedScript.includes('tỷ lệ 16:9') ||
    normalizedScript.includes('khung hình 16:9')
  ) {
    return 'landscape';
  }

  return 'portrait';
}

<<<<<<< HEAD
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
=======
function buildVideoPrompt(script: string, aspectRatio: FlowAspectRatio) {
>>>>>>> 92b6eb5e45b1f1f2d914f4dad9d2a3efd94f7134
  const formatInstruction = aspectRatio === 'landscape'
    ? 'Create a realistic 8-second horizontal landscape video in true 16:9 composition from the uploaded start image. Fill the entire 16:9 frame naturally; do not place a vertical video inside a horizontal canvas and do not add black bars.'
    : 'Create a realistic 8-second vertical portrait video in true 9:16 composition from the uploaded start image. Fill the entire 9:16 frame naturally; do not add black bars.';

<<<<<<< HEAD
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
=======
  return [
    formatInstruction,
    'The person in the start image speaks naturally in Vietnamese.',
    'Keep the same face, identity, age, hairstyle, outfit, skin tone and overall appearance as the start image.',
    'Keep the same main background and environment. Extend the background naturally only as needed to fill the selected frame.',
    'Natural lip movement, friendly professional expression, stable camera, clean lighting.',
    'Do not add text overlay, captions, watermark, logo, distorted face or extra people.',
    'Use the Vietnamese regional accent specified in the script. Do not mix accents.',
>>>>>>> 92b6eb5e45b1f1f2d914f4dad9d2a3efd94f7134
    `Script/content: ${script.trim()}`
  ].filter(Boolean).join(' ');
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
    const aspectRatio = resolveFlowAspectRatio(formData.get('aspectRatio'), script);
<<<<<<< HEAD
    const region = readVideoRegion(formData.get('region'));
    const emotion = readVideoEmotion(formData.get('emotion'));
=======
>>>>>>> 92b6eb5e45b1f1f2d914f4dad9d2a3efd94f7134

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
<<<<<<< HEAD
      prompt: buildVideoPrompt(script, aspectRatio, region, emotion),
=======
      prompt: buildVideoPrompt(script, aspectRatio),
>>>>>>> 92b6eb5e45b1f1f2d914f4dad9d2a3efd94f7134
      model,
      aspectRatio,
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
      aspectRatio,
<<<<<<< HEAD
      region: region || undefined,
      emotion: emotion || undefined,
=======
>>>>>>> 92b6eb5e45b1f1f2d914f4dad9d2a3efd94f7134
      raw: videoResult
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Lỗi server không xác định.', 500);
  }
}
