import type { VideoScript } from './video-script';

export type ExistingVideoScenePayload = {
  sceneNumber: number;
  duration: 8;
  model: 'veo-3.1-lite';
  script: string;
};

type VoiceProfile = {
  label: string;
  excluded: string;
};

const VOICE_PROFILES: Record<VideoScript['region'], VoiceProfile> = {
  'Giọng Bắc': {
    label: 'a clear, standard Northern Vietnamese accent (giọng miền Bắc Việt Nam, giọng Bắc Hà Nội)',
    excluded: 'Central Vietnamese, Southern Vietnamese, generic Vietnamese, neutral Vietnamese and mixed regional accents'
  },
  'Giọng Trung': {
    label: 'a clear, standard Central Vietnamese accent (giọng miền Trung Việt Nam)',
    excluded: 'Northern Vietnamese, Southern Vietnamese, generic Vietnamese, neutral Vietnamese and mixed regional accents'
  },
  'Giọng Nam': {
    label: 'a clear, standard Southern Vietnamese accent (giọng miền Nam Việt Nam)',
    excluded: 'Northern Vietnamese, Central Vietnamese, generic Vietnamese, neutral Vietnamese and mixed regional accents'
  }
};

function buildReferencePrompt(script: VideoScript) {
  const voice = VOICE_PROFILES[script.region];
  const frame = script.aspectRatio === '16:9'
    ? 'Render a true horizontal 16:9 video. Fill the complete frame with no black bars.'
    : 'Render a true vertical 9:16 video. Fill the complete frame with no black bars.';

  return [
    'Based on the uploaded reference image.',
    'Use the uploaded image as the strict visual reference for the complete video.',
    'Keep the same person, identity, face, facial features, hairstyle, hair color, outfit, body proportions, product, product color, product shape, background, environment, lighting, framing, camera composition and visual style.',
    'Maintain complete character consistency and scene consistency.',
    'No morphing, identity change, face change, hairstyle change, outfit change, product change, background change or visual redesign.',
    `The person speaks Vietnamese with ${voice.label}.`,
    'Use one fixed speaker profile across all scenes. Keep the same tone, pitch, timbre, speaking speed, rhythm, pronunciation and delivery style.',
    `Do not use ${voice.excluded}.`,
    'Do not switch, drift or mix accents. Do not change the speaker between scenes.',
    'Speech is articulate, natural and clearly understandable.',
    'Natural lip movements are accurately synchronized with the speech rhythm.',
    `The speaking expression is ${script.emotion}, with a professional, confident, clear, calm and trustworthy delivery.`,
    'The person remains in the exact setting shown in the reference image and looks naturally toward the camera.',
    'Static camera and locked shot. No zoom, pan or sudden reframing.',
    'Use subtle facial micro-expressions, natural eye blinking every 3 to 4 seconds and gentle realistic head movements.',
    'Only subtle natural hand and body movements are allowed.',
    'Photorealistic rendering. Preserve the original lighting and atmosphere.',
    frame,
    'No scene cut, scene change, location change, character replacement, new outfit, product replacement, new objects or extra people.',
    'No text overlay, subtitles, captions, watermark, logo or random characters.'
  ].join(' ');
}

/**
 * Chỉ chuẩn hóa prompt vào trường script của pipeline hiện tại.
 * Không thay đổi upload ảnh, API tạo video, API job, polling hoặc videoUrl.
 */
export function mapScriptScenesToExistingVideoPayload(script: VideoScript): ExistingVideoScenePayload[] {
  const referencePrompt = buildReferencePrompt(script);
  const selectedVoice = VOICE_PROFILES[script.region].label;

  return script.scenes.map((scene) => ({
    sceneNumber: scene.sceneNumber,
    duration: 8,
    model: 'veo-3.1-lite',
    script: [
      `Scene ${scene.sceneNumber} of ${script.scenes.length}. Exact duration: 8 seconds.`,
      referencePrompt,
      `Required voice: Vietnamese spoken only with ${selectedVoice}.`,
      `Spoken line: Speak this exact Vietnamese sentence once, naturally and completely: “${scene.voiceover.trim()}”`,
      'Start speaking promptly and finish the complete sentence before the scene ends. Do not repeat, paraphrase, add or omit words.',
      `Content intent: ${scene.objective.trim()}. Keep the same person, setting, background, outfit, product, camera position and composition.`,
      `Performance expression: ${script.emotion}. Facial detail: ${scene.facialExpression.trim()}. Use subtle expressions only.`,
      `Output aspect ratio: ${script.aspectRatio}. Fill the complete frame without black bars.`,
      'Do not follow scene, action or camera descriptions that require a new location, different background, different person, different outfit, different product, cut, zoom, pan or changed composition.',
      'Negative prompt: no morphing, identity drift, face change, hairstyle change, outfit change, product change, background change, location change, scene cut, visual reset, camera movement, speaker change, accent change, voice change, text, subtitles, captions, watermark or logo.'
    ].join(' ')
  }));
}
