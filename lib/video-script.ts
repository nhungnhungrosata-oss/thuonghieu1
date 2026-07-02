export const SCENE_DURATION_SECONDS = 8 as const;
export const VIDEO_DURATIONS = [16, 24, 32, 40, 48] as const;
export const ALLOWED_SCENE_COUNTS = [2, 3, 4, 5, 6] as const;
export const VIDEO_REGIONS = ['Giọng Bắc', 'Giọng Trung', 'Giọng Nam'] as const;
export const VIDEO_EMOTIONS = [
  'Tự nhiên, thân thiện',
  'Tự tin, chuyên nghiệp',
  'Vui vẻ, tích cực',
  'Nhiệt huyết, truyền cảm hứng',
  'Nghiêm túc, đáng tin cậy',
  'Gần gũi, chân thành',
  'Bình tĩnh, nhẹ nhàng',
  'Mạnh mẽ, thuyết phục'
] as const;
export const VIDEO_ASPECT_RATIOS = ['9:16', '16:9'] as const;

export type VideoDuration = (typeof VIDEO_DURATIONS)[number];
export type SceneCount = (typeof ALLOWED_SCENE_COUNTS)[number];
export type VideoRegion = (typeof VIDEO_REGIONS)[number];
export type VideoEmotion = (typeof VIDEO_EMOTIONS)[number];
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export type VideoScene = {
  sceneNumber: number;
  duration: number;
  objective: string;
  visualDescription: string;
  characterAction: string;
  facialExpression: string;
  camera: string;
  voiceover: string;
  videoPrompt: string;
};

export type VideoScript = {
  title: string;
  summary: string;
  totalDuration: number;
  sceneDuration: number;
  region: VideoRegion;
  emotion: VideoEmotion;
  aspectRatio: VideoAspectRatio;
  scenes: VideoScene[];
};

export type ScriptGenerationRequest = {
  mode?: 'generate';
  content: string;
  sceneCount: SceneCount;
  region: VideoRegion;
  emotion: VideoEmotion;
  aspectRatio: VideoAspectRatio;
};

export type SceneRewriteRequest = {
  mode: 'rewrite-scene';
  sceneCount: SceneCount;
  region: VideoRegion;
  emotion: VideoEmotion;
  aspectRatio: VideoAspectRatio;
  summary: string;
  scene: VideoScene;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function isVideoDuration(value: unknown): value is VideoDuration {
  return typeof value === 'number' && VIDEO_DURATIONS.includes(value as VideoDuration);
}

export function sceneCountFromDuration(duration: VideoDuration): SceneCount {
  return (duration / SCENE_DURATION_SECONDS) as SceneCount;
}

export function isSceneCount(value: unknown): value is SceneCount {
  return typeof value === 'number' && ALLOWED_SCENE_COUNTS.includes(value as SceneCount);
}

export function isVideoRegion(value: unknown): value is VideoRegion {
  return typeof value === 'string' && VIDEO_REGIONS.includes(value as VideoRegion);
}

export function isVideoEmotion(value: unknown): value is VideoEmotion {
  return typeof value === 'string' && VIDEO_EMOTIONS.includes(value as VideoEmotion);
}

export function isVideoAspectRatio(value: unknown): value is VideoAspectRatio {
  return typeof value === 'string' && VIDEO_ASPECT_RATIOS.includes(value as VideoAspectRatio);
}

export function normalizeVideoScene(value: unknown, expectedSceneNumber?: number): VideoScene | null {
  if (!isRecord(value)) return null;

  const sceneNumber = value.sceneNumber;
  const duration = value.duration;
  if (typeof sceneNumber !== 'number' || !Number.isInteger(sceneNumber)) return null;
  if (expectedSceneNumber !== undefined && sceneNumber !== expectedSceneNumber) return null;
  if (typeof duration !== 'number' || duration !== SCENE_DURATION_SECONDS) return null;

  const objective = readRequiredString(value, 'objective');
  const visualDescription = readRequiredString(value, 'visualDescription');
  const characterAction = readRequiredString(value, 'characterAction');
  const facialExpression = readRequiredString(value, 'facialExpression');
  const camera = readRequiredString(value, 'camera');
  const voiceover = readRequiredString(value, 'voiceover');
  const videoPrompt = readRequiredString(value, 'videoPrompt');

  if (
    !objective ||
    !visualDescription ||
    !characterAction ||
    !facialExpression ||
    !camera ||
    !voiceover ||
    !videoPrompt
  ) {
    return null;
  }

  return {
    sceneNumber,
    duration,
    objective,
    visualDescription,
    characterAction,
    facialExpression,
    camera,
    voiceover,
    videoPrompt
  };
}

export function normalizeVideoScript(
  value: unknown,
  expectedSceneCount: SceneCount,
  expectedRegion: VideoRegion,
  expectedEmotion: VideoEmotion,
  expectedAspectRatio: VideoAspectRatio
): VideoScript | null {
  if (!isRecord(value) || !Array.isArray(value.scenes)) return null;

  const title = readRequiredString(value, 'title');
  const summary = readRequiredString(value, 'summary');
  if (!title || !summary) return null;

  if (value.totalDuration !== expectedSceneCount * SCENE_DURATION_SECONDS) return null;
  if (value.sceneDuration !== SCENE_DURATION_SECONDS) return null;
  if (value.region !== expectedRegion || value.emotion !== expectedEmotion || value.aspectRatio !== expectedAspectRatio) {
    return null;
  }
  if (value.scenes.length !== expectedSceneCount) return null;

  const scenes: VideoScene[] = [];
  for (let index = 0; index < value.scenes.length; index += 1) {
    const scene = normalizeVideoScene(value.scenes[index], index + 1);
    if (!scene) return null;
    scenes.push(scene);
  }

  return {
    title,
    summary,
    totalDuration: expectedSceneCount * SCENE_DURATION_SECONDS,
    sceneDuration: SCENE_DURATION_SECONDS,
    region: expectedRegion,
    emotion: expectedEmotion,
    aspectRatio: expectedAspectRatio,
    scenes
  };
}

export function isCompleteVideoScript(script: VideoScript | null, expectedSceneCount: SceneCount): script is VideoScript {
  if (!script || script.scenes.length !== expectedSceneCount) return false;
  return script.scenes.every((scene, index) => {
    return (
      scene.sceneNumber === index + 1 &&
      scene.duration === SCENE_DURATION_SECONDS &&
      scene.objective.trim().length > 0 &&
      scene.voiceover.trim().length > 0 &&
      scene.visualDescription.trim().length > 0 &&
      scene.characterAction.trim().length > 0 &&
      scene.facialExpression.trim().length > 0 &&
      scene.camera.trim().length > 0 &&
      scene.videoPrompt.trim().length > 0
    );
  });
}
