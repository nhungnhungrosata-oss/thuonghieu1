'use client';

import type { SceneCount, VideoAspectRatio, VideoScene, VideoScript } from '../../lib/video-script';
import type { EditableSceneField, MergeState, SceneVideoState } from './client-types';
import SceneCard from './SceneCard';
import styles from '../../app/kich-ban-video-chia-se/page.module.css';

type Props = {
  scriptResult: VideoScript | null;
  error: string;
  notice: string;
  overallStatus: string;
  editingSceneNumber: number | null;
  rewritingSceneNumber: number | null;
  copiedSceneNumber: number | null;
  videoStates: Record<number, SceneVideoState>;
  videoError: string;
  sceneCount: SceneCount;
  aspectRatio: VideoAspectRatio;
  sourceContent: string;
  scriptLoading: boolean;
  videoGenerating: boolean;
  canCreateVideo: boolean;
  completedVideos: number;
  hasImage: boolean;
  mergeState: MergeState;
  finalVideoUrl: string;
  finalFileName: string;
  onCopyScene: (scene: VideoScene) => void;
  onToggleEditScene: (sceneNumber: number) => void;
  onRewriteScene: (scene: VideoScene) => void;
  onRetryScene: (sceneNumber: number) => void;
  onUpdateSceneField: (sceneNumber: number, field: EditableSceneField, value: string) => void;
  onRewriteAll: () => void;
  onCreateVideos: () => void;
  onMergeVideos: () => void;
  onDownloadFinal: () => void;
};

export default function ResultPanel(props: Props) {
  const script = props.scriptResult;
  const progressPercent = props.sceneCount ? Math.round((props.completedVideos / props.sceneCount) * 100) : 0;

  return (
    <section className={styles.resultPanel}>
      <div className={styles.resultHeader}>
        <div>
          <span className={styles.eyebrow}>AI VIDEO WORKSPACE</span>
          <h1>Xây dựng thương hiệu cá nhân bằng video AI</h1>
          <p>Phân cảnh thông minh, tạo từng clip 8 giây bằng pipeline hiện tại, ghép và tải video hoàn chỉnh.</p>
        </div>
        <a className={styles.backLink} href="/">Mở công cụ 8 giây cũ</a>
      </div>

      <div className={styles.progressPanel}>
        <div className={styles.progressTopline}>
          <div>
            <span>Trạng thái</span>
            <strong>{props.overallStatus}</strong>
          </div>
          <b>{props.completedVideos}/{props.sceneCount} cảnh</b>
        </div>
        <div className={styles.progressTrack} aria-label={`Đã hoàn thành ${progressPercent}%`}>
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {(props.error || props.notice) && (
        <div className={props.error ? styles.errorMessage : styles.noticeMessage} role="status" aria-live="polite">
          {props.error || props.notice}
        </div>
      )}

      {!script ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>✦</div>
          <h3>Sẵn sàng xây dựng kịch bản</h3>
          <p>Chọn ảnh, nhập chủ đề và thiết lập phong cách ở cột bên trái. DeepSeek sẽ tạo một kịch bản liền mạch từ 2 đến 6 cảnh.</p>
          <div className={styles.emptyChecklist}>
            <span>Hook thu hút</span>
            <span>Lời thoại vừa 8 giây</span>
            <span>Prompt không chữ/logo</span>
            <span>Cảnh nối tiếp logic</span>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.scriptOverview}>
            <div>
              <span>Tiêu đề</span>
              <strong>{script.title}</strong>
            </div>
            <div>
              <span>Tóm tắt</span>
              <p>{script.summary}</p>
            </div>
            <div className={styles.scriptMeta}>
              <span>{script.totalDuration} giây</span>
              <span>{script.region}</span>
              <span>{script.emotion}</span>
              <span>{script.aspectRatio}</span>
            </div>
          </div>

          <div className={styles.sceneList}>
            {script.scenes.map((scene) => (
              <SceneCard
                key={scene.sceneNumber}
                scene={scene}
                aspectRatio={props.aspectRatio}
                isEditing={props.editingSceneNumber === scene.sceneNumber}
                isRewriting={props.rewritingSceneNumber === scene.sceneNumber}
                isCopied={props.copiedSceneNumber === scene.sceneNumber}
                scriptLoading={props.scriptLoading}
                rewritingSceneNumber={props.rewritingSceneNumber}
                videoGenerating={props.videoGenerating}
                videoState={props.videoStates[scene.sceneNumber]}
                onCopy={props.onCopyScene}
                onToggleEdit={() => props.onToggleEditScene(scene.sceneNumber)}
                onRewrite={props.onRewriteScene}
                onRetryScene={props.onRetryScene}
                onUpdateField={props.onUpdateSceneField}
              />
            ))}
          </div>

          {props.videoError && <div className={styles.errorMessage}>{props.videoError}</div>}

          {props.finalVideoUrl && (
            <section className={styles.finalVideoCard}>
              <div className={styles.finalVideoHeader}>
                <div>
                  <span>VIDEO HOÀN CHỈNH</span>
                  <h3>{props.finalFileName}</h3>
                </div>
                <span className={styles.completedBadge}>Đã ghép xong</span>
              </div>
              <video
                className={styles.finalVideoPlayer}
                src={props.finalVideoUrl}
                controls
                playsInline
                style={{ aspectRatio: props.aspectRatio === '9:16' ? '9 / 16' : '16 / 9' }}
              />
              <button type="button" className={styles.downloadFinalButton} onClick={props.onDownloadFinal}>
                Tải video
              </button>
            </section>
          )}

          <div className={styles.bottomActions}>
            <button
              type="button"
              className={styles.secondaryLargeButton}
              disabled={props.scriptLoading || props.rewritingSceneNumber !== null || props.videoGenerating || !props.sourceContent.trim()}
              onClick={props.onRewriteAll}
            >
              {props.scriptLoading ? 'Đang viết lại...' : 'Viết lại toàn bộ'}
            </button>
            <button
              type="button"
              className={styles.createVideoButton}
              disabled={!props.canCreateVideo}
              onClick={props.onCreateVideos}
            >
              {props.videoGenerating
                ? `Đang xử lý ${props.completedVideos}/${props.sceneCount}`
                : props.completedVideos > 0
                  ? 'Tiếp tục tạo video'
                  : 'Tạo video'}
            </button>
            {props.completedVideos === props.sceneCount && !props.finalVideoUrl && (
              <button
                type="button"
                className={styles.mergeButton}
                disabled={props.mergeState === 'merging' || props.videoGenerating}
                onClick={props.onMergeVideos}
              >
                {props.mergeState === 'merging' ? 'Đang ghép video...' : 'Ghép lại video'}
              </button>
            )}
          </div>

          {!props.hasImage && <p className={styles.validationHint}>Hãy chọn ảnh nhân vật để kích hoạt nút Tạo video.</p>}
          {script.scenes.length !== props.sceneCount && (
            <p className={styles.validationHint}>Số cảnh hiện tại chưa khớp thời lượng. Hãy phân cảnh lại.</p>
          )}
          <p className={styles.pipelineNote}>
            Mỗi cảnh vẫn dùng đúng <code>POST /api/generate</code>, <code>GET /api/job</code> và ba trường <code>image</code>, <code>script</code>, <code>model</code>. Hai API cũ không bị thay đổi.
          </p>
        </>
      )}
    </section>
  );
}
