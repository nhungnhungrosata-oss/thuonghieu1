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
const MAX_VOICEOVER_WORDS = 30;

const SYSTEM_PROMPT = `Bạn là biên kịch video ngắn chuyên xây dựng thương hiệu cá nhân tại Việt Nam.

Nhiệm vụ của bạn là biến nội dung người dùng thành một kịch bản monologue liền mạch, một nhân vật nói trực tiếp trước camera.

Yêu cầu bắt buộc:
1. Chia đúng số cảnh được yêu cầu; mỗi cảnh chính xác 8 giây.
2. Xây dựng toàn bộ câu chuyện theo mạch hook, vấn đề, giá trị/giải pháp, kết luận và CTA khi phù hợp.
3. Các cảnh phải nối tiếp tự nhiên, không lặp ý, không phải các đoạn rời rạc.
4. Mỗi lời thoại tối đa 30 từ tiếng Việt, ưu tiên 18–24 từ để nói hết tự nhiên trong 8 giây.
5. Giữ cách xưng hô, nhân vật, bối cảnh và phong cách nhất quán.
6. Điều chỉnh từ ngữ và nhịp nói phù hợp giọng vùng miền được chọn nhưng không dùng tiếng địa phương khó hiểu.
7. Biểu cảm khuôn mặt, ánh mắt, cử chỉ tay và cơ thể phải phù hợp nội dung.
8. Prompt phải yêu cầu giữ nguyên nhân vật từ ảnh tham chiếu giữa mọi cảnh.
9. Trong mọi prompt phải ghi rõ: không văn bản, không logo, không watermark, không ký tự ngẫu nhiên, không render phụ đề vào video.
10. Không tạo thông tin sai lệch, cam kết quá mức hoặc nội dung vi phạm.
11. Không thêm markdown.
12. Chỉ trả về JSON hợp lệ đúng schema.
13. Không đưa chain-of-thought, reasoning hoặc giải thích quá trình suy luận vào kết quả.`;

type DeepSeekChoice = {
  finish_reason?: string;
  message?: {
    content?: string | null;
  };
};

type DeepSeekResponse = {
  choices?: DeepSeekChoice[];
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

function parseJsonContent(content: string): unknown {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

function mapDeepSeekHttpError(status: number) {
  if (status === 402) return jsonError('Tài khoản DeepSeek không đủ số dư.', 402);
  if (status === 429) return jsonError('DeepSeek đang quá tải, vui lòng thử lại sau.', 429);
  if (status === 401 || status === 403) return jsonError('Không thể xác thực DeepSeek API Key.', 502);
  if (status >= 500) return jsonError('DeepSeek đang quá tải, vui lòng thử lại sau.', 503);
  return jsonError('Không thể kết nối dịch vụ viết kịch bản.', 502);
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function enforcePromptRules(
  scene: VideoScene,
  region: VideoRegion,
  emotion: VideoEmotion,
  aspectRatio: VideoAspectRatio
): VideoScene {
  const safetyInstruction = [
    `Tỷ lệ khung hình ${aspectRatio}.`,
    `Giọng nói ${region}, nhịp nói tự nhiên và rõ ràng.`,
    `Biểu cảm chủ đạo ${emotion}.`,
    'Giữ nguyên khuôn mặt, nhận diện, tuổi, tóc, trang phục và ngoại hình của nhân vật từ ảnh tham chiếu.',
    'Không hiển thị văn bản, không logo, không watermark, không ký tự ngẫu nhiên và không render phụ đề trực tiếp vào video.'
  ].join(' ');

  return {
    ...scene,
    videoPrompt: `${scene.videoPrompt.trim()} ${safetyInstruction}`.trim()
  };
}

async function callDeepSeek(messages: Array<{ role: 'system' | 'user'; content: string }>, maxTokens: number) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return { errorResponse: jsonError('Chưa cấu hình DeepSeek API Key.', 500) } as const;
  }

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
        temperature: 0.65,
        response_format: { type: 'json_object' },
        max_tokens: maxTokens
      }),
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      return { errorResponse: mapDeepSeekHttpError(response.status) } as const;
    }

    let data: DeepSeekResponse;
    try {
      data = (await response.json()) as DeepSeekResponse;
    } catch {
      return { errorResponse: jsonError('DeepSeek không trả về kịch bản hợp lệ.', 502) } as const;
    }

    const choice = data.choices?.[0];
    if (!choice) {
      return { errorResponse: jsonError('DeepSeek không trả về kịch bản hợp lệ.', 502) } as const;
    }

    if (choice.finish_reason === 'length') {
      return { errorResponse: jsonError('Kịch bản bị cắt do vượt giới hạn. Vui lòng rút gọn nội dung.', 502) } as const;
    }

    if (choice.finish_reason === 'insufficient_system_resource') {
      return { errorResponse: jsonError('DeepSeek đang quá tải, vui lòng thử lại sau.', 503) } as const;
    }

    const content = choice.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return { errorResponse: jsonError('DeepSeek không trả về kịch bản hợp lệ.', 502) } as const;
    }

    try {
      return { value: parseJsonContent(content) } as const;
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

  return `Hãy xây dựng kịch bản video thương hiệu cá nhân dựa trên thông tin sau:

Nội dung gốc:
${content}

Tổng thời lượng: ${totalDuration} giây
Số cảnh: ${sceneCount}
Thời lượng mỗi cảnh: ${SCENE_DURATION_SECONDS} giây
Giọng vùng miền: ${region}
Biểu cảm nhân vật: ${emotion}
Tỷ lệ video: ${aspectRatio}
Định dạng: một nhân vật nói trực tiếp trước camera, dùng cùng ảnh nhân vật làm tham chiếu cho mọi cảnh.

Hãy chủ động tổ chức nội dung thành một câu chuyện hoàn chỉnh, khoa học và có giá trị. Cảnh đầu cần hook mạnh. Các cảnh giữa triển khai logic. Cảnh cuối kết luận hoặc CTA phù hợp. Lời thoại mỗi cảnh tối đa ${MAX_VOICEOVER_WORDS} từ, ưu tiên 18–24 từ.

Chỉ trả về một JSON object hợp lệ, không code fence, đúng schema:
{
  "title": "Tiêu đề video",
  "summary": "Tóm tắt mạch nội dung toàn video",
  "totalDuration": ${totalDuration},
  "sceneDuration": ${SCENE_DURATION_SECONDS},
  "region": "${region}",
  "emotion": "${emotion}",
  "aspectRatio": "${aspectRatio}",
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": ${SCENE_DURATION_SECONDS},
      "objective": "Mục tiêu truyền thông của cảnh",
      "visualDescription": "Bối cảnh và nội dung hình ảnh",
      "characterAction": "Hành động, ánh mắt, cử chỉ tay và chuyển động cơ thể",
      "facialExpression": "Biểu cảm khuôn mặt cụ thể",
      "camera": "Góc máy, khung hình và chuyển động camera",
      "voiceover": "Lời nhân vật nói, đủ ngắn cho 8 giây",
      "videoPrompt": "Prompt tạo video hoàn chỉnh; phải có yêu cầu không chữ, không logo, không watermark, không phụ đề render trực tiếp và giữ nhân vật nhất quán"
    }
  ]
}

Bắt buộc scenes.length = ${sceneCount}; sceneNumber liên tục từ 1 đến ${sceneCount}; duration luôn bằng 8; không để trường nào rỗng.`;
}

function buildRewriteScenePrompt(
  summary: string,
  scene: VideoScene,
  sceneCount: SceneCount,
  region: VideoRegion,
  emotion: VideoEmotion,
  aspectRatio: VideoAspectRatio
) {
  return `Viết lại duy nhất cảnh dưới đây, không trả về các cảnh khác.

Tóm tắt toàn bộ kịch bản:
${summary}

Tổng số cảnh: ${sceneCount}
Giọng vùng miền: ${region}
Biểu cảm: ${emotion}
Tỷ lệ video: ${aspectRatio}
Cảnh cần viết lại:
${JSON.stringify(scene)}

Giữ nguyên sceneNumber = ${scene.sceneNumber} và duration = ${SCENE_DURATION_SECONDS}. Cảnh mới phải nối tự nhiên với mạch tóm tắt, lời thoại tối đa ${MAX_VOICEOVER_WORDS} từ và đủ nói trong 8 giây. Prompt phải giữ nhân vật nhất quán, không văn bản, không logo, không watermark, không ký tự ngẫu nhiên và không render phụ đề.

Chỉ trả về JSON:
{
  "scene": {
    "sceneNumber": ${scene.sceneNumber},
    "duration": ${SCENE_DURATION_SECONDS},
    "objective": "Mục tiêu cảnh",
    "visualDescription": "Nội dung hình ảnh và bối cảnh",
    "characterAction": "Hành động, ánh mắt, cử chỉ và chuyển động cơ thể",
    "facialExpression": "Biểu cảm khuôn mặt",
    "camera": "Góc máy và chuyển động camera",
    "voiceover": "Lời thoại đủ ngắn cho 8 giây",
    "videoPrompt": "Prompt tạo video hoàn chỉnh"
  }
}`;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return jsonError('Dữ liệu yêu cầu không hợp lệ.', 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError('Dữ liệu yêu cầu không hợp lệ.', 400);
  }

  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    return jsonError('Chưa cấu hình DeepSeek API Key.', 500);
  }

  if (body.mode !== undefined && body.mode !== 'generate' && body.mode !== 'rewrite-scene') {
    return jsonError('Chế độ tạo kịch bản không hợp lệ.', 400);
  }

  const sceneCount = body.sceneCount;
  const region = body.region;
  const emotion = body.emotion;
  const aspectRatio = body.aspectRatio;

  if (
    !isSceneCount(sceneCount) ||
    !isVideoRegion(region) ||
    !isVideoEmotion(emotion) ||
    !isVideoAspectRatio(aspectRatio)
  ) {
    return jsonError('Tùy chọn tạo kịch bản không hợp lệ.', 400);
  }

  if (body.mode === 'rewrite-scene') {
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (!summary || summary.length > MAX_SUMMARY_LENGTH) {
      return jsonError('Tóm tắt kịch bản không hợp lệ.', 400);
    }

    const currentSceneNumber =
      typeof body.scene === 'object' && body.scene !== null && !Array.isArray(body.scene)
        ? (body.scene as Record<string, unknown>).sceneNumber
        : undefined;
    if (typeof currentSceneNumber !== 'number') {
      return jsonError('Cảnh cần viết lại không hợp lệ.', 400);
    }

    const scene = normalizeVideoScene(body.scene, currentSceneNumber);
    if (!scene || scene.sceneNumber < 1 || scene.sceneNumber > sceneCount) {
      return jsonError('Cảnh cần viết lại không hợp lệ.', 400);
    }

    const result = await callDeepSeek(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildRewriteScenePrompt(summary, scene, sceneCount, region, emotion, aspectRatio) }
      ],
      1800
    );
    if ('errorResponse' in result) return result.errorResponse;

    const resultRecord =
      typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)
        ? result.value as Record<string, unknown>
        : null;
    const normalized = normalizeVideoScene(resultRecord?.scene, scene.sceneNumber);
    if (!normalized || countWords(normalized.voiceover) > MAX_VOICEOVER_WORDS) {
      return jsonError('DeepSeek trả về cảnh quá dài hoặc sai cấu trúc.', 502);
    }

    return NextResponse.json({
      ok: true,
      scene: enforcePromptRules(normalized, region, emotion, aspectRatio)
    });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content || content.length > MAX_INPUT_LENGTH) {
    return jsonError('Nội dung phải có từ 1 đến 12.000 ký tự.', 400);
  }

  const result = await callDeepSeek(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildFullScriptPrompt(content, sceneCount, region, emotion, aspectRatio) }
    ],
    5400
  );
  if ('errorResponse' in result) return result.errorResponse;

  const normalized = normalizeVideoScript(result.value, sceneCount, region, emotion, aspectRatio);
  if (!normalized || normalized.scenes.some((scene) => countWords(scene.voiceover) > MAX_VOICEOVER_WORDS)) {
    return jsonError('DeepSeek trả về kịch bản quá dài hoặc sai cấu trúc.', 502);
  }

  return NextResponse.json({
    ok: true,
    script: {
      ...normalized,
      scenes: normalized.scenes.map((scene) => enforcePromptRules(scene, region, emotion, aspectRatio))
    }
  });
}
