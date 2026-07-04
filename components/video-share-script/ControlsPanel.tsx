'use client';

import { ChangeEvent, useRef } from 'react';
import {
  SCENE_DURATION_SECONDS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  VIDEO_EMOTIONS,
  VIDEO_REGIONS,
  getVideoRegionDisplayLabel,
  isVideoAspectRatio,
  isVideoDuration,
  isVideoEmotion,
  isVideoRegion,
  sceneCountFromDuration,
  type VideoAspectRatio,
  type VideoDuration,
  type VideoEmotion,
  type VideoRegion
} from '../../lib/video-script';
import styles from '../../app/kich-ban-video-chia-se/page.module.css';

type Props = {
  hasImage: boolean;
  previewUrl: string;
  sourceContent: string;
  videoDuration: VideoDuration;
  region: VideoRegion;
  emotion: VideoEmotion;
  aspectRatio: VideoAspectRatio;
  scriptLoading: boolean;
  rewritingSceneNumber: number | null;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: () => void;
  onSourceContentChange: (value: string) => void;
  onVideoDurationChange: (value: VideoDuration) => void;
  onRegionChange: (value: VideoRegion) => void;
  onEmotionChange: (value: VideoEmotion) => void;
  onAspectRatioChange: (value: VideoAspectRatio) => void;
  onGenerateScript: () => void;
};

export default function ControlsPanel(props: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sceneCount = sceneCountFromDuration(props.videoDuration);

  function removeImage() {
    props.onRemoveImage();
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <aside className={styles.controlPanel}>
      <div className={styles.brandBlock}>
        <span className={styles.brandMark}>PB</span>
        <div>
          <strong>Personal Brand AI</strong>
          <small>Video thương hiệu cá nhân</small>
        </div>
      </div>

      <section className={styles.panelSection}>
        <div className={styles.sectionHeading}>
          <span className={styles.stepNumber}>1</span>
          <div>
            <h2>Ảnh nhân vật</h2>
            <p>Ảnh được giữ nguyên cho pipeline video hiện tại.</p>
          </div>
        </div>

        <input
          ref={inputRef}
          className={styles.hiddenInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={props.onImageChange}
        />

        {props.previewUrl ? (
          <div className={styles.imagePreviewWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.imagePreview}
              src={props.previewUrl}
              alt="Ảnh nhân vật xem trước"
              style={{ aspectRatio: props.aspectRatio === '9:16' ? '9 / 16' : '16 / 9' }}
            />
            <div className={styles.imageActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => inputRef.current?.click()}>
                Thay ảnh
              </button>
              <button type="button" className={styles.dangerButton} onClick={removeImage}>
                Xóa ảnh
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={styles.uploadBox} onClick={() => inputRef.current?.click()}>
            <span className={styles.uploadIcon}>＋</span>
            <strong>Chọn ảnh nhân vật</strong>
            <small>JPG, PNG, WEBP · tối đa 4MB</small>
          </button>
        )}
      </section>

      <section className={styles.panelSection}>
        <div className={styles.sectionHeading}>
          <span className={styles.stepNumber}>2</span>
          <div>
            <h2>Nội dung video</h2>
            <p>Nhập chủ đề, kiến thức, câu chuyện hoặc nội dung bán hàng.</p>
          </div>
        </div>
        <textarea
          className={styles.sourceTextarea}
          value={props.sourceContent}
          maxLength={12000}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => props.onSourceContentChange(event.target.value)}
          placeholder="Ví dụ: Hãy xây dựng video chia sẻ 3 sai lầm phổ biến khi bắt đầu kinh doanh online..."
        />
        <div className={styles.characterCounter}>{props.sourceContent.length.toLocaleString('vi-VN')} / 12.000</div>
      </section>

      <section className={styles.panelSection}>
        <div className={styles.selectGrid}>
          <label className={styles.fieldLabel}>
            <span>Thời lượng</span>
            <select
              value={props.videoDuration}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const value = Number(event.target.value);
                if (isVideoDuration(value)) props.onVideoDurationChange(value);
              }}
            >
              {VIDEO_DURATIONS.map((duration) => (
                <option key={duration} value={duration}>
                  {duration} giây · {sceneCountFromDuration(duration)} cảnh
                </option>
              ))}
            </select>
          </label>

          <label className={styles.fieldLabel}>
            <span>Giọng vùng miền</span>
            <select
              value={props.region}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const value = event.target.value;
                if (isVideoRegion(value)) props.onRegionChange(value);
              }}
            >
              {VIDEO_REGIONS.map((item) => (
                <option key={item} value={item}>{getVideoRegionDisplayLabel(item)}</option>
              ))}
            </select>
          </label>

          <label className={styles.fieldLabel + ' ' + styles.fullWidthField}>
            <span>Biểu cảm nhân vật</span>
            <select
              value={props.emotion}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const value = event.target.value;
                if (isVideoEmotion(value)) props.onEmotionChange(value);
              }}
            >
              {VIDEO_EMOTIONS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>

          <label className={styles.fieldLabel}>
            <span>Tỷ lệ video</span>
            <select
              value={props.aspectRatio}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const value = event.target.value;
                if (isVideoAspectRatio(value)) props.onAspectRatioChange(value);
              }}
            >
              {VIDEO_ASPECT_RATIOS.map((item) => (
                <option key={item} value={item}>
                  {item} · {item === '9:16' ? 'TikTok/Reels/Shorts' : 'YouTube ngang'}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.readonlyField}>
            <span>Cấu trúc</span>
            <strong>{sceneCount} cảnh × {SCENE_DURATION_SECONDS} giây</strong>
          </div>
        </div>
      </section>

      <button
        type="button"
        className={styles.primaryButton}
        disabled={props.scriptLoading || props.rewritingSceneNumber !== null || !props.sourceContent.trim()}
        onClick={props.onGenerateScript}
      >
        {props.scriptLoading ? 'Đang xây dựng kịch bản...' : 'Phân cảnh và tạo lời thoại'}
      </button>
    </aside>
  );
}
