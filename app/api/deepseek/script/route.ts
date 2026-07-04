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
// Ngưỡng chấp nhận thực tế khi kiểm tra: chỉ nới 2 từ so với mức tối thiểu (không phải 4)
// để tránh việc AI "chạm đáy" 20 từ vẫn được coi là đạt. Giới hạn tối đa vẫn là quy định CỨNG, không nới.
const MIN_ACCEPTABLE_WORDS = MIN_VOICEOVER_WORDS - 2;

const SYSTEM_PROMPT = `Bạn là biên kịch video ngắn với hơn 20 năm kinh nghiệm sản xuất nội dung viral cho TikTok, Reels và YouTube Shorts tại Việt Nam. Bạn có tai nghe nhạy với nhịp đọc của giọng nói tiếng Việt và biết chính xác một câu thoại cần dài bao nhiêu để vừa khít với hình ảnh, không bị hụt hơi cũng không bị cắt ngang.

Mỗi cảnh trong video có thời lượng cố định 8 giây. Trước khi viết voiceover cho một cảnh, hãy tưởng tượng bạn đang đọc to đoạn đó với tốc độ dẫn chuyện tự nhiên (không đọc vội, không kéo dài), và ước lượng xem nó có vừa khít 8 giây hay không. Với tốc độ đó, một câu thoại tiếng Việt vừa khít 8 giây thường rơi vào khoảng ${MIN_VOICEOVER_WORDS}-${MAX_VOICEOVER_WORDS} từ — đây là cảm nhận về nhịp đọc thực tế, không phải một con số cần đếm máy móc. Nếu phân vân giữa viết ngắn hay dài, hãy nghiêng về phía dài hơn trong khoảng đó (gần ${MAX_VOICEOVER_WORDS} từ) thay vì chỉ chạm mức tối thiểu — 8 giây là khoảng thời gian khá đủ để diễn đạt trọn vẹn một ý, đừng bỏ phí. Hãy để câu văn tự nhiên, có cảm xúc và đúng văn phong dẫn dắt trước, sau đó tinh chỉnh độ dài sao cho vừa vặn nhịp đọc đó.

Các cảnh phải nối tiếp thành một bài nói duy nhất: cảnh đầu tạo hook cuốn người xem trong vài giây đầu, các cảnh giữa phát triển ý mạch lạc, cảnh cuối chốt thông điệp hoặc lời kêu gọi hành động.
Từ cảnh 2 trở đi không chào lại, không tạo hook mới, không lặp ý và không viết như một video độc lập — người xem phải cảm nhận đây là một mạch nói liền mạch từ đầu đến cuối.
Giữ nguyên nhân vật, khuôn mặt, trang phục, bối cảnh, cách xưng hô và phong cách xuyên suốt toàn bộ video.
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
  return total >= MIN_ACCEPTABLE_WORDS && total <= MAX_VOICEOVER_WORDS;
}

function voiceoverError() {
  return `Mỗi lời thoại phải có tối đa ${MAX_VOICEOVER_WORDS} từ.`;
}

const MAX_GENERATION_ATTEMPTS = 4;

// Dự phòng cuối cùng: nếu sau nhiều lần tự sửa AI vẫn vượt quá giới hạn tối đa, tự cắt gọn cục bộ
// để không bao giờ chặn người dùng bằng lỗi độ dài lời thoại.
function autoFixVoiceoverLength(voiceover: string): string {
  const words = voiceover.trim().split(/\s+/).filter(Boolean);
  if (words.length > MAX_VOICEOVER_WORDS) {
    const trimmed = words.slice(0, MAX_VOICEOVER_WORDS).join(' ').replace(/[.,;:!?…]+$/, '');
    return `${trimmed}.`;
  }
  return voiceover;
}

function sceneWordIssue(scene: VideoScene): string | null {
  const total = countWords(scene.voiceover);
  // Hụt nhẹ dưới mức tối thiểu (nhưng không quá ít) là chấp nhận được, không tính là lỗi cần sửa.
  if (total < MIN_ACCEPTABLE_WORDS) return `Cảnh ${scene.sceneNumber}: hiện có ${total} từ, quá ngắn, cần tối thiểu khoảng ${MIN_VOICEOVER_WORDS} từ.`;
  if (total > MAX_VOICEOVER_WORDS) return `Cảnh ${scene.sceneNumber}: hiện có ${total} từ, VƯỢT QUÁ giới hạn cứng ${MAX_VOICEOVER_WORDS} từ, bắt buộc phải rút ngắn lại.`;
  return null;
}

function buildScriptCorrectionPrompt(sceneCount: SceneCount, issues: string[]) {
  return `Bản kịch bản vừa trả về CHƯA đạt yêu cầu số từ cho voiceover. Chi tiết lỗi:
${issues.join('\n')}

Hãy trả lại TOÀN BỘ JSON đầy đủ ${sceneCount} cảnh theo đúng schema cũ, giữ nguyên các cảnh đã đúng, chỉ viết lại phần voiceover (và visualDescription/characterAction nếu cần khớp) của những cảnh bị liệt kê ở trên sao cho có đúng từ ${MIN_VOICEOVER_WORDS} đến ${MAX_VOICEOVER_WORDS} từ tiếng Việt. Tự đếm lại từng voiceover trước khi trả kết quả. Chỉ trả JSON, không thêm giải thích.`;
}

function buildSceneCorrectionPrompt(issue: string) {
  return `Cảnh vừa viết lại CHƯA đạt yêu cầu số từ. ${issue}
Hãy viết lại đúng cảnh này với voiceover có từ ${MIN_VOICEOVER_WORDS} đến ${MAX_VOICEOVER_WORDS} từ tiếng Việt, giữ nguyên nội dung, nhân vật, bối cảnh. Tự đếm lại trước khi trả kết quả. Chỉ trả JSON đúng schema cũ, không giải thích.`;
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
    `Nói hết lời thoại trong cảnh 8 giây, tối đa ${MAX_VOICEOVER_WORDS} từ (giới hạn cứng).`,
    'Giữ nguyên nhân vật, khuôn mặt, tóc, trang phục, bối cảnh, ánh sáng và bố cục từ ảnh tham chiếu.',
    'Không đổi địa điểm, không đổi nền, không thêm người, không chữ, không logo, không watermark và không phụ đề.'
  ].join(' ');
  return { ...scene, videoPrompt: `${scene.videoPrompt.trim()} ${rules}`.trim() };
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type DeepSeekCallResult =
  | { errorResponse: NextResponse<{ ok: boolean; message: string }> }
  | { value: unknown; raw: string };

async function callDeepSeek(messages: ChatMessage[], maxTokens: number): Promise<DeepSeekCallResult> {
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

    const raw = choice.message.content;
    try {
      return { value: parseJsonContent(raw), raw } as const;
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
- Mỗi voiceover cần vừa khít 8 giây khi đọc với tốc độ dẫn chuyện tự nhiên — tương đương khoảng ${MIN_VOICEOVER_WORDS}-${MAX_VOICEOVER_WORDS} từ tiếng Việt. Nếu phân vân, hãy nghiêng về phía ${MAX_VOICEOVER_WORDS} từ hơn là chỉ chạm mức ${MIN_VOICEOVER_WORDS} từ. Hãy cảm nhận nhịp đọc thực tế thay vì đếm từ một cách máy móc, và ưu tiên câu văn tự nhiên, đúng cảm xúc.
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
    "voiceover": "Lời thoại vừa khít 8 giây đọc tự nhiên, khoảng ${MIN_VOICEOVER_WORDS}-${MAX_VOICEOVER_WORDS} từ",
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
Voiceover cần vừa khít 8 giây khi đọc với tốc độ tự nhiên — tương đương khoảng ${MIN_VOICEOVER_WORDS}-${MAX_VOICEOVER_WORDS} từ tiếng Việt. Hãy cảm nhận nhịp đọc thực tế trước khi chốt câu chữ, ưu tiên tự nhiên hơn là đếm từ máy móc.
Giữ nguyên sceneNumber, duration = 8, nhân vật, trang phục và bối cảnh. Không chữ, logo, watermark hoặc phụ đề.
Chỉ trả JSON: {"scene":{"sceneNumber":${scene.sceneNumber},"duration":8,"objective":"...","visualDescription":"...","characterAction":"...","facialExpression":"...","camera":"...","voiceover":"khoảng ${MIN_VOICEOVER_WORDS}-${MAX_VOICEOVER_WORDS} từ, vừa khít 8 giây","videoPrompt":"..."}}`;
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

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildRewriteScenePrompt(summary, scene, sceneCount, region, emotion, aspectRatio) }
    ];

    let bestScene: VideoScene | null = null;
    let lastErrorResponse = jsonError(voiceoverError(), 502);

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const result = await callDeepSeek(messages, 1800);
      if ('errorResponse' in result) {
        lastErrorResponse = result.errorResponse;
        break;
      }
      const record = typeof result.value === 'object' && result.value !== null
        ? result.value as Record<string, unknown>
        : null;
      const candidate = normalizeVideoScene(record?.scene, scene.sceneNumber);

      if (candidate && hasValidVoiceoverLength(candidate)) {
        bestScene = candidate;
        break;
      }
      if (candidate) bestScene = candidate;

      if (attempt === MAX_GENERATION_ATTEMPTS) break;
      const issue = candidate ? sceneWordIssue(candidate) : `Cảnh ${scene.sceneNumber}: JSON chưa đúng cấu trúc, cần trả đúng schema.`;
      messages.push({ role: 'assistant', content: result.raw });
      messages.push({ role: 'user', content: buildSceneCorrectionPrompt(issue ?? '') });
    }

    if (!bestScene) return lastErrorResponse;

    // Tự động thử lại nhiều lần vẫn chưa đạt -> tự cắt gọn cục bộ để không chặn người dùng
    const finalScene: VideoScene = hasValidVoiceoverLength(bestScene)
      ? bestScene
      : { ...bestScene, voiceover: autoFixVoiceoverLength(bestScene.voiceover) };

    return NextResponse.json({ ok: true, scene: enforcePromptRules(finalScene, region, emotion, aspectRatio) });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content || content.length > MAX_INPUT_LENGTH) {
    return jsonError('Nội dung phải có từ 1 đến 12.000 ký tự.');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildFullScriptPrompt(content, sceneCount, region, emotion, aspectRatio) }
  ];

  let bestScript: ReturnType<typeof normalizeVideoScript> = null;
  let lastErrorResponse = jsonError(voiceoverError(), 502);

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const result = await callDeepSeek(messages, 5400);
    if ('errorResponse' in result) {
      lastErrorResponse = result.errorResponse;
      break;
    }

    const candidate = normalizeVideoScript(result.value, sceneCount, region, emotion, aspectRatio);
    const issues = candidate ? candidate.scenes.map(sceneWordIssue).filter((v): v is string => Boolean(v)) : [];

    if (candidate && issues.length === 0) {
      bestScript = candidate;
      break;
    }
    if (candidate && (!bestScript || issues.length < bestScript.scenes.map(sceneWordIssue).filter(Boolean).length)) {
      bestScript = candidate;
    }

    if (attempt === MAX_GENERATION_ATTEMPTS) break;
    messages.push({ role: 'assistant', content: result.raw });
    messages.push({
      role: 'user',
      content: buildScriptCorrectionPrompt(
        sceneCount,
        issues.length > 0 ? issues : [`Toàn bộ kịch bản chưa đúng cấu trúc JSON yêu cầu, hãy trả đúng schema với ${sceneCount} cảnh.`]
      )
    });
  }

  if (!bestScript) return lastErrorResponse;

  // Tự động thử lại nhiều lần vẫn còn cảnh lệch -> tự cắt gọn cục bộ để không chặn người dùng
  const finalScript = {
    ...bestScript,
    scenes: bestScript.scenes.map((scene) => {
      const fixed = hasValidVoiceoverLength(scene) ? scene : { ...scene, voiceover: autoFixVoiceoverLength(scene.voiceover) };
      return enforcePromptRules(fixed, region, emotion, aspectRatio);
    })
  };

  return NextResponse.json({ ok: true, script: finalScript });
}
