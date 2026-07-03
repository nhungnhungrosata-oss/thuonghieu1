import { NextRequest, NextResponse } from 'next/server';
import {
  SCENE_DURATION_SECONDS,
  isSceneCount,
  isVideoAspectRatio,
  isVideoEmotion,
  isVideoRegion,
  normalizeVideoScene,
  normalizeVideoScript,
  type SceneCount,
  type VideoAspectRatio,
  type VideoEmotion,
  type VideoRegion,
  type VideoScene
} from '../../../../lib/video-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_INPUT_LENGTH = 12_000;
const MAX_SUMMARY_LENGTH = 2_000;
const MIN_VOICEOVER_WORDS = 24;
const MAX_VOICEOVER_WORDS = 28;

const SYSTEM_PROMPT = `Bạn là biên kịch video ngắn tại Việt Nam.
Mỗi cảnh dài đúng 8 giây và mỗi voiceover BẮT BUỘC có từ ${MIN_VOICEOVER_WORDS} đến ${MAX_VOICEOVER_WORDS} từ tiếng Việt.
Không được ít hơn ${MIN_VOICEOVER_WORDS} từ và không được vượt quá ${MAX_VOICEOVER_WORDS} từ.
Hãy tự đếm số từ của từng voiceover trước khi trả kết quả và viết lại ngay nếu chưa đạt.
Các cảnh phải nối tiếp thành một bài nói duy nhất: cảnh đầu tạo hook, cảnh giữa phát triển ý, cảnh cuối chốt thông điệp hoặc CTA.
Từ cảnh 2 không chào lại, không tạo hook mới, không lặp ý và không viết như video độc lập.
Giữ nguyên nhân vật, khuôn mặt, trang phục, bối cảnh, cách xưng hô và phong cách trong toàn bộ video.
Mọi videoPrompt phải ghi rõ không chữ, không logo, không watermark và không phụ đề render sẵn.
Chỉ trả JSON hợp lệ đúng schema, không thêm markdown hay giải thích.`;

type DeepSeekResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null };
  }>;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function parseJsonContent(content: string): unknown {
  let cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function hasValidVoiceoverLength(scene: VideoScene) {
  const total = countWords(scene.voiceover);
  return total >= MIN_VOICEOVER_WORDS && total <= MAX_VOICEOVER_WORDS;
}

function voiceoverError() {
  return `Mỗi lời thoại phải có từ ${MIN_VOICEOVER_WORDS} đến ${MAX_VOICEOVER_WORDS} từ.`;
}

function enforcePromptRules(
  scene: VideoScene,
  region: VideoRegion,
  emotion: VideoEmotion,
  aspectRatio: VideoAspectRatio
): VideoScene {
  const rules = [
    `Tỷ lệ khung hình ${aspectRatio}.`,
    `Giọng nói ${region}, rõ ràng và tự nhiên.`,
    `Biểu cảm chủ đạo ${emotion}.`,
    `Nói hết lời thoại ${MIN_VOICEOVER_WORDS}–${MAX_VOICEOVER_WORDS} từ trong cảnh 8 giây.`,
    'Giữ nguyên nhân vật, khuôn mặt, tóc, trang phục, bối cảnh, ánh sáng và bố cục từ ảnh tham chiếu.',
    'Không đổi địa điểm, không đổi nền, không thêm người, không chữ, không logo, không watermark và không phụ đề.'
  ].join(' ');
  return { ...scene, videoPrompt: `${scene.videoPrompt.trim()} ${rules}`.trim() };
}

async function callDeepSeek(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTokens: number
) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return { errorResponse: jsonError('Chưa cấu hình DeepSeek API Key.', 500) } as const;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
        messages,
        stream: false,
        thinking: { type: 'disabled' },
        temperature: 0.5,
        response_format: { type: 'json_object' },
        max_tokens: maxTokens
      }),
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      if (response.status === 402) return { errorResponse: jsonError('Tài khoản DeepSeek không đủ số dư.', 402) } as const;
      if (response.status === 429) return { errorResponse: jsonError('DeepSeek đang quá tải, vui lòng thử lại sau.', 429) } as const;
      if (response.status === 401 || response.status === 403) {
        return { errorResponse: jsonError('Không thể xác thực DeepSeek API Key.', 502) } as const;
      }
      return { errorResponse: jsonError('Không thể kết nối dịch vụ viết kịch bản.', 502) } as const;
    }

    const data = await response.json() as DeepSeekResponse;
    const choice = data.choices?.[0];
    if (!choice?.message?.content || choice.finish_reason === 'length') {
      return { errorResponse: jsonError('DeepSeek không trả về kịch bản đầy đủ.', 502) } as const;
    }

    try {
      return { value: parseJsonContent(choice.message.content) } as const;
    } catch {
      return { errorResponse: jsonError('DeepSeek không trả về JSON hợp lệ.', 502) } as const;
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { errorResponse: jsonError('Yêu cầu DeepSeek mất quá nhiều thời gian.', 504) } as const;
    }
    return { errorResponse: jsonError('Không thể kết nối dịch vụ viết kịch bản.', 502) } as const;
  } finally {
    clearTimeout(timeout);
  }
}

function buildFullScriptPrompt(
  content: string,
  sceneCount: SceneCount,
  region: VideoRegion,
  emotion: VideoEmotion,
  aspectRatio: VideoAspectRatio
) {
  const totalDuration = sceneCount * SCENE_DURATION_SECONDS;
  return `Tạo kịch bản video từ nội dung sau:
${content}

Số cảnh: ${sceneCount}. Mỗi cảnh: 8 giây. Tổng thời lượng: ${totalDuration} giây.
Giọng: ${region}. Biểu cảm: ${emotion}. Tỷ lệ: ${aspectRatio}.

QUY TẮC BẮT BUỘC:
- Mỗi voiceover phải có từ ${MIN_VOICEOVER_WORDS} đến ${MAX_VOICEOVER_WORDS} từ tiếng Việt, không ít hơn và không nhiều hơn.
- Tự đếm từng voiceover trước khi trả JSON.
- Các cảnh nối liền thành một bài nói duy nhất; không chào lại, không lặp ý.
- Giữ nguyên nhân vật, trang phục và bối cảnh. Không chữ, logo, watermark hoặc phụ đề.

Chỉ trả JSON theo schema:
{
  "title": "Tiêu đề",
  "summary": "Tóm tắt",
  "totalDuration": ${totalDuration},
  "sceneDuration": 8,
  "region": "${region}",
  "emotion": "${emotion}",
  "aspectRatio": "${aspectRatio}",
  "scenes": [{
    "sceneNumber": 1,
    "duration": 8,
    "objective": "Mục tiêu cảnh",
    "visualDescription": "Mô tả hình ảnh",
    "characterAction": "Hành động",
    "facialExpression": "Biểu cảm",
    "camera": "Góc máy",
    "voiceover": "Lời thoại ${MIN_VOICEOVER_WORDS}–${MAX_VOICEOVER_WORDS} từ",
    "videoPrompt": "Prompt tạo video"
  }]
}
Bắt buộc scenes.length = ${sceneCount}, sceneNumber liên tục và mọi trường đều có dữ liệu.`;
}

function buildRewriteScenePrompt(
  summary: string,
  scene: VideoScene,
  sceneCount: SceneCount,
  region: VideoRegion,
  emotion: VideoEmotion,
  aspectRatio: VideoAspectRatio
) {
  return `Viết lại duy nhất cảnh ${scene.sceneNumber}/${sceneCount}.
Tóm tắt: ${summary}
Cảnh hiện tại: ${JSON.stringify(scene)}
Giọng: ${region}. Biểu cảm: ${emotion}. Tỷ lệ: ${aspectRatio}.
Voiceover bắt buộc từ ${MIN_VOICEOVER_WORDS} đến ${MAX_VOICEOVER_WORDS} từ tiếng Việt. Hãy tự đếm trước khi trả kết quả.
Giữ nguyên sceneNumber, duration = 8, nhân vật, trang phục và bối cảnh. Không chữ, logo, watermark hoặc phụ đề.
Chỉ trả JSON: {"scene":{"sceneNumber":${scene.sceneNumber},"duration":8,"objective":"...","visualDescription":"...","characterAction":"...","facialExpression":"...","camera":"...","voiceover":"${MIN_VOICEOVER_WORDS}–${MAX_VOICEOVER_WORDS} từ","videoPrompt":"..."}}`;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return jsonError('Dữ liệu yêu cầu không hợp lệ.');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError('Dữ liệu yêu cầu không hợp lệ.');
  }

  const sceneCount = body.sceneCount;
  const region = body.region;
  const emotion = body.emotion;
  const aspectRatio = body.aspectRatio;
  if (!isSceneCount(sceneCount) || !isVideoRegion(region) || !isVideoEmotion(emotion) || !isVideoAspectRatio(aspectRatio)) {
    return jsonError('Tùy chọn tạo kịch bản không hợp lệ.');
  }

  if (body.mode === 'rewrite-scene') {
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    const currentNumber = typeof body.scene === 'object' && body.scene !== null
      ? (body.scene as Record<string, unknown>).sceneNumber
      : undefined;
    if (!summary || summary.length > MAX_SUMMARY_LENGTH || typeof currentNumber !== 'number') {
      return jsonError('Cảnh cần viết lại không hợp lệ.');
    }
    const scene = normalizeVideoScene(body.scene, currentNumber);
    if (!scene || scene.sceneNumber < 1 || scene.sceneNumber > sceneCount) {
      return jsonError('Cảnh cần viết lại không hợp lệ.');
    }
    const result = await callDeepSeek([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildRewriteScenePrompt(summary, scene, sceneCount, region, emotion, aspectRatio) }
    ], 1800);
    if ('errorResponse' in result) return result.errorResponse;
    const record = typeof result.value === 'object' && result.value !== null
      ? result.value as Record<string, unknown>
      : null;
    const normalized = normalizeVideoScene(record?.scene, scene.sceneNumber);
    if (!normalized || !hasValidVoiceoverLength(normalized)) return jsonError(voiceoverError(), 502);
    return NextResponse.json({ ok: true, scene: enforcePromptRules(normalized, region, emotion, aspectRatio) });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content || content.length > MAX_INPUT_LENGTH) {
    return jsonError('Nội dung phải có từ 1 đến 12.000 ký tự.');
  }

  const result = await callDeepSeek([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildFullScriptPrompt(content, sceneCount, region, emotion, aspectRatio) }
  ], 5400);
  if ('errorResponse' in result) return result.errorResponse;

  const normalized = normalizeVideoScript(result.value, sceneCount, region, emotion, aspectRatio);
  if (!normalized || normalized.scenes.some((scene) => !hasValidVoiceoverLength(scene))) {
    return jsonError(voiceoverError(), 502);
  }

  return NextResponse.json({
    ok: true,
    script: {
      ...normalized,
      scenes: normalized.scenes.map((scene) => enforcePromptRules(scene, region, emotion, aspectRatio))
    }
  });
}
