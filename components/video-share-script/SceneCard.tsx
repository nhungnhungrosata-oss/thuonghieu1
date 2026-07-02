'use client';

import { ChangeEvent } from 'react';
import type { VideoAspectRatio, VideoScene } from '../../lib/video-script';
import type { EditableSceneField, SceneVideoState } from './client-types';
import styles from '../../app/kich-ban-video-chia-se/page.module.css';

type Props = {
  scene: VideoScene;
  aspectRatio: VideoAspectRatio;
  isEditing: boolean;
  isRewriting: boolean;
  isCopied: boolean;
  scriptLoading: boolean;
  rewritingSceneNumber: number | null;
  videoGenerating: boolean;
  videoState?: SceneVideoState;
  onCopy: (scene: VideoScene) => void;
  onToggleEdit: () => void;
  onRewrite: (scene: VideoScene) => void;
  onRetryScene: (sceneNumber: number) => void;
  onUpdateField: (sceneNumber: number, field: EditableSceneField, value: string) => void;
};

function sceneStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: 'Chưa tạo',
    uploading: 'Đang chuẩn bị',
    created: 'Đã nhận Job ID',
    pending: 'Đang chờ xử lý',
    processing: 'Đang tạo',
    running: 'Đang tạo',
    completed: 'Hoàn thành',
    failed: 'Lỗi'
  };
  return labels[status] || status;
}

export default function SceneCard(props: Props) {
  const { scene, videoState } = props;

  return (
    <article className={styles.sceneCard}>
      <div className={styles.sceneCardHeader}>
        <div>
          <span className={styles.sceneIndex}>Cảnh {scene.sceneNumber}</span>
          <span className={styles.sceneDuration}>{scene.duration} giây</span>
          {videoState && (
            <span className={
              videoState.status === 'completed'
                ? styles.statusSuccess
                : videoState.status === 'failed'
                  ? styles.statusError
                  : styles.statusProgress
            }>
              {sceneStatusLabel(videoState.status)}
            </span>
          )}
        </div>
        <div className={styles.sceneActions}>
          <button type="button" onClick={() => props.onCopy(scene)}>
            {props.isCopied ? 'Đã sao chép' : 'Sao chép'}
          </button>
          <button type="button" onClick={props.onToggleEdit} disabled={props.videoGenerating}>
            {props.isEditing ? 'Xong' : 'Chỉnh sửa'}
          </button>
          <button
            type="button"
            disabled={props.scriptLoading || props.rewritingSceneNumber !== null || props.videoGenerating}
            onClick={() => props.onRewrite(scene)}
          >
            {props.isRewriting ? 'Đang viết lại...' : 'Viết lại'}
          </button>
          {videoState?.status === 'failed' && (
            <button
              type="button"
              className={styles.retryButton}
              disabled={props.videoGenerating}
              onClick={() => props.onRetryScene(scene.sceneNumber)}
            >
              Thử lại cảnh
            </button>
          )}
        </div>
      </div>

      {props.isEditing ? (
        <div className={styles.editGrid}>
          {([
            ['objective', 'Mục tiêu cảnh'],
            ['voiceover', 'Lời thoại'],
            ['visualDescription', 'Nội dung hình ảnh'],
            ['characterAction', 'Hành động nhân vật'],
            ['facialExpression', 'Biểu cảm'],
            ['camera', 'Góc máy và chuyển động'],
            ['videoPrompt', 'Prompt tạo video']
          ] as Array<[EditableSceneField, string]>).map(([field, label]) => (
            <label key={field} className={field === 'voiceover' || field === 'videoPrompt' ? styles.wideEditField : ''}>
              <span>{label}</span>
              <textarea
                value={scene[field]}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  props.onUpdateField(scene.sceneNumber, field, event.target.value)
                }
              />
            </label>
          ))}
        </div>
      ) : (
        <div className={styles.sceneContent}>
          <div className={styles.voiceoverBlock}>
            <span>Lời thoại</span>
            <p>“{scene.voiceover}”</p>
          </div>
          <dl className={styles.sceneDetails}>
            <div><dt>Mục tiêu</dt><dd>{scene.objective}</dd></div>
            <div><dt>Nội dung hình ảnh</dt><dd>{scene.visualDescription}</dd></div>
            <div><dt>Hành động nhân vật</dt><dd>{scene.characterAction}</dd></div>
            <div><dt>Biểu cảm</dt><dd>{scene.facialExpression}</dd></div>
            <div><dt>Góc máy</dt><dd>{scene.camera}</dd></div>
            <div className={styles.fullDetail}><dt>Prompt tạo video</dt><dd>{scene.videoPrompt}</dd></div>
          </dl>
        </div>
      )}

      {videoState && (
        <div className={styles.videoResultBox}>
          <div className={styles.videoStatusRow}>
            <strong>Video cảnh {scene.sceneNumber}</strong>
            <span>{sceneStatusLabel(videoState.status)}</span>
          </div>
          {videoState.jobId && <small>Job ID: {videoState.jobId}</small>}
          {videoState.error && <p className={styles.inlineError}>{videoState.error}</p>}
          {videoState.videoUrl && (
            <>
              <video
                className={styles.videoPlayer}
                src={videoState.videoUrl}
                controls
                playsInline
                style={{ aspectRatio: props.aspectRatio === '9:16' ? '9 / 16' : '16 / 9' }}
              />
              <a className={styles.downloadLink} href={videoState.videoUrl} target="_blank" rel="noreferrer">
                Mở / tải video cảnh {scene.sceneNumber}
              </a>
            </>
          )}
        </div>
      )}
    </article>
  );
}
