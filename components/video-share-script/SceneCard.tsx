'use client';

import { ChangeEvent } from 'react';
import type { VideoAspectRatio, VideoScene } from '../../lib/video-script';
import type { EditableSceneField, SceneVideoState } from './client-types';
import styles from '../../app/kich-ban-video-chia-se/page.module.css';
import processingStyles from './processing.module.css';

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
    created: 'Đã tiếp nhận',
    pending: 'Đang chờ xử lý',
    processing: 'Đang tạo video',
    running: 'Đang tạo video',
    completed: 'Hoàn thành',
    failed: 'Lỗi'
  };
  return labels[status] || status;
}

function isActiveVideoStatus(status?: string) {
  return ['uploading', 'created', 'pending', 'processing', 'running'].includes(status || '');
}

function countWords(value: string) {
  const normalized = value.trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

const wordCounterStyle = {
  flexShrink: 0,
  border: '1px solid rgba(124, 108, 255, 0.28)',
  borderRadius: '999px',
  padding: '4px 8px',
  color: '#d9d4ff',
  background: 'rgba(124, 108, 255, 0.13)',
  fontSize: '10px',
  fontWeight: 800,
  lineHeight: 1.2,
  letterSpacing: 'normal',
  textTransform: 'none' as const
};

export default function SceneCard(props: Props) {
  const { scene, videoState } = props;
  const isActive = isActiveVideoStatus(videoState?.status);
  const wordCount = countWords(scene.voiceover);

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
          <label className={styles.wideEditField}>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: '6px'
              }}
            >
              <span style={{ marginBottom: 0 }}>Lời thoại</span>
              <strong style={wordCounterStyle} aria-live="polite">
                {wordCount} từ
              </strong>
            </span>
            <textarea
              value={scene.voiceover}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                props.onUpdateField(scene.sceneNumber, 'voiceover' as EditableSceneField, event.target.value)
              }
            />
          </label>
        </div>
      ) : (
        <div className={styles.sceneContent}>
          <div className={styles.voiceoverBlock}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: '6px'
              }}
            >
              <span style={{ marginBottom: 0 }}>Lời thoại</span>
              <strong style={wordCounterStyle}>{wordCount} từ</strong>
            </div>
            <p>“{scene.voiceover}”</p>
          </div>
        </div>
      )}

      {videoState && (
        <div className={styles.videoResultBox}>
          <div className={styles.videoStatusRow}>
            <strong>Video cảnh {scene.sceneNumber}</strong>
            <span>{sceneStatusLabel(videoState.status)}</span>
          </div>

          {isActive && (
            <div className={processingStyles.sceneProcessing} role="status" aria-live="polite">
              <span className={processingStyles.spinner} aria-hidden="true" />
              <div>
                <strong>Đang tạo video cảnh {scene.sceneNumber}</strong>
                <p>Quá trình có thể mất vài phút. Vui lòng giữ trang này mở và chờ hệ thống tự cập nhật.</p>
              </div>
            </div>
          )}

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
