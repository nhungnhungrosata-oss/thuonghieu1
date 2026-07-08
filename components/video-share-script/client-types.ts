import type { VideoScene } from '../../lib/video-script';

export type SceneVideoStatus =
  | 'queued'
  | 'uploading'
  | 'created'
  | 'pending'
  | 'processing'
  | 'running'
  | 'completed'
  | 'failed';

export type SceneVideoState = {
  sceneNumber: number;
  status: SceneVideoStatus;
  jobId?: string;
  generationId?: string;
  recoveryToken?: string;
  videoUrl?: string;
  error?: string;
};

export type MergeState = 'idle' | 'merging' | 'completed' | 'failed';

export type EditableSceneField = Exclude<keyof VideoScene, 'sceneNumber' | 'duration'>;
