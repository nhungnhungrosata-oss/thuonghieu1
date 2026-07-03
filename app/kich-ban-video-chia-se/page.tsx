'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import ControlsPanel from '../../components/video-share-script/ControlsPanel';
import ResultPanel from '../../components/video-share-script/ResultPanel';
import type { EditableSceneField, MergeState, SceneVideoState } from '../../components/video-share-script/client-types';
import {
  isCompleteVideoScript,
  isVideoAspectRatio,
  isVideoDuration,
  isVideoEmotion,
  isVideoRegion,
  normalizeVideoScript,
  sceneCountFromDuration,
  type SceneCount,
  type VideoAspectRatio,
  type VideoDuration,
  type VideoEmotion,
  type VideoRegion,
  type VideoScene,
  type VideoScript
} from '../../lib/video-script';
import { mapScriptScenesToExistingVideoPayload } from '../../lib/existing-video-adapter';
import styles from './page.module.css';

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DRAFT_KEY = 'personal-brand-video-draft-v2';
const DEFAULT_DURATION: VideoDuration = 24;
const DEFAULT_REGION: VideoRegion = 'Giọng Bắc';
const DEFAULT_EMOTION: VideoEmotion = 'Tự nhiên, thân thiện';
const DEFAULT_ASPECT_RATIO: VideoAspectRatio = '9:16';

type ScriptApiResponse = { ok: boolean; message?: string; script?: VideoScript; scene?: VideoScene };
type GenerateResponse = { ok: boolean; jobId?: string; message?: string };
type JobResponse = { ok: boolean; status?: string; videoUrl?: string; error?: string };
type MergeErrorResponse = { ok?: boolean; message?: string };

function formatFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function readResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text || '{}') as T;
    } catch {
      return { ok: false, message: 'Phản hồi từ máy chủ không hợp lệ.' } as T;
    }
  }
  return {
    ok: false,
    message: text || `Yêu cầu thất bại với HTTP ${response.status}`,
    error: text || `Yêu cầu thất bại với HTTP ${response.status}`
  } as T;
}

function makeVideoFileName() {
  return `personal-brand-video-${Date.now()}.mp4`;
}

export default function VideoShareScriptPage() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [videoDuration, setVideoDuration] = useState<VideoDuration>(DEFAULT_DURATION);
  const [region, setRegion] = useState<VideoRegion>(DEFAULT_REGION);
  const [emotion, setEmotion] = useState<VideoEmotion>(DEFAULT_EMOTION);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(DEFAULT_ASPECT_RATIO);
  const [scriptResult, setScriptResult] = useState<VideoScript | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [rewritingSceneNumber, setRewritingSceneNumber] = useState<number | null>(null);
  const [editingSceneNumber, setEditingSceneNumber] = useState<number | null>(null);
  const [copiedSceneNumber, setCopiedSceneNumber] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [overallStatus, setOverallStatus] = useState('Đang chuẩn bị');
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [videoStates, setVideoStates] = useState<Record<number, SceneVideoState>>({});
  const [mergeState, setMergeState] = useState<MergeState>('idle');
  const [finalVideoUrl, setFinalVideoUrl] = useState('');
  const [finalFileName, setFinalFileName] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const mountedRef = useRef(true);
  const generationLockRef = useRef(false);
  const videoStatesRef = useRef<Record<number, SceneVideoState>>({});
  const finalVideoUrlRef = useRef('');

  const sceneCount = sceneCountFromDuration(videoDuration);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (finalVideoUrlRef.current) URL.revokeObjectURL(finalVideoUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!image) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const draft = JSON.parse(saved) as Record<string, unknown>;
      const savedDuration = isVideoDuration(draft.videoDuration) ? draft.videoDuration : DEFAULT_DURATION;
      const savedRegion = isVideoRegion(draft.region) ? draft.region : DEFAULT_REGION;
      const savedEmotion = isVideoEmotion(draft.emotion) ? draft.emotion : DEFAULT_EMOTION;
      const savedAspectRatio = isVideoAspectRatio(draft.aspectRatio) ? draft.aspectRatio : DEFAULT_ASPECT_RATIO;
      const savedSceneCount = sceneCountFromDuration(savedDuration);

      setVideoDuration(savedDuration);
      setRegion(savedRegion);
      setEmotion(savedEmotion);
      setAspectRatio(savedAspectRatio);
      if (typeof draft.sourceContent === 'string') setSourceContent(draft.sourceContent);

      const savedScript = normalizeVideoScript(
        draft.scriptResult,
        savedSceneCount,
        savedRegion,
        savedEmotion,
        savedAspectRatio
      );
      if (savedScript) setScriptResult(savedScript);
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ sourceContent, videoDuration, region, emotion, aspectRatio, scriptResult })
    );
  }, [draftLoaded, sourceContent, videoDuration, region, emotion, aspectRatio, scriptResult]);

  const validScript = useMemo(() => isCompleteVideoScript(scriptResult, sceneCount), [scriptResult, sceneCount]);
  const completedVideos = useMemo(
    () => Object.values(videoStates).filter((item) => item.status === 'completed' && item.videoUrl).length,
    [videoStates]
  );
  const canCreateVideo = Boolean(image && validScript && !videoGenerating && !scriptLoading && rewritingSceneNumber === null);

  function replaceVideoStates(next: Record<number, SceneVideoState>) {
    videoStatesRef.current = next;
    if (mountedRef.current) setVideoStates(next);
  }

  function updateVideoState(sceneNumber: number, patch: Partial<SceneVideoState>) {
    const current = videoStatesRef.current;
    const previous = current[sceneNumber];
    const nextState: SceneVideoState = {
      ...previous,
      ...patch,
      sceneNumber,
      status: patch.status ?? previous?.status ?? 'queued'
    };
    const next = { ...current, [sceneNumber]: nextState };
    replaceVideoStates(next);
  }

  function clearFinalVideo() {
    if (finalVideoUrlRef.current) {
      URL.revokeObjectURL(finalVideoUrlRef.current);
      finalVideoUrlRef.current = '';
    }
    setFinalVideoUrl('');
    setFinalFileName('');
    setMergeState('idle');
  }

  function clearVideoOutput() {
    replaceVideoStates({});
    setVideoError('');
    clearFinalVideo();
  }

  function invalidateScriptForOptionChange() {
    setScriptResult(null);
    setEditingSceneNumber(null);
    clearVideoOutput();
    setError('');
    setNotice('Tùy chọn đã thay đổi. Hãy phân cảnh lại để cập nhật toàn bộ prompt.');
    setOverallStatus('Đang chuẩn bị');
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError('');
    setNotice('');
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError('Ảnh phải là JPG, JPEG, PNG hoặc WEBP.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError(`Ảnh đang là ${formatFileSize(file.size)}. Vui lòng chọn ảnh dưới 4MB.`);
      event.target.value = '';
      return;
    }
    setImage(file);
    clearVideoOutput();
    setOverallStatus('Ảnh đã sẵn sàng');
  }

  function removeImage() {
    setImage(null);
    clearVideoOutput();
    setOverallStatus('Đang chuẩn bị');
  }

  async function generateFullScript() {
    const content = sourceContent.trim();
    if (!content) {
      setError('Nội dung video không được để trống.');
      return;
    }

    setScriptLoading(true);
    setError('');
    setNotice('DeepSeek đang phân tích nội dung và xây dựng mạch kịch bản...');
    setOverallStatus('Đang phân cảnh và tạo lời thoại');

    try {
      const response = await fetch('/api/deepseek/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, sceneCount, region, emotion, aspectRatio })
      });
      const data = await readResponse<ScriptApiResponse>(response);
      if (!response.ok || !data.ok || !data.script) {
        throw new Error(data.message || 'DeepSeek không trả về kịch bản hợp lệ.');
      }

      setScriptResult(data.script);
      setEditingSceneNumber(null);
      clearVideoOutput();
      setNotice(`Đã tạo ${data.script.scenes.length} cảnh liền mạch. Bạn có thể chỉnh sửa trước khi tạo video.`);
      setOverallStatus(`Đã phân cảnh ${data.script.scenes.length} cảnh`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể kết nối dịch vụ viết kịch bản.');
      setNotice('');
      setOverallStatus('Lỗi tạo kịch bản');
    } finally {
      setScriptLoading(false);
    }
  }

  async function rewriteScene(scene: VideoScene) {
    if (!scriptResult || rewritingSceneNumber !== null) return;

    setRewritingSceneNumber(scene.sceneNumber);
    setError('');
    setNotice(`DeepSeek đang viết lại cảnh ${scene.sceneNumber}...`);

    try {
      const response = await fetch('/api/deepseek/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'rewrite-scene',
          sceneCount,
          region,
          emotion,
          aspectRatio,
          summary: scriptResult.summary,
          scene
        })
      });
      const data = await readResponse<ScriptApiResponse>(response);
      if (!response.ok || !data.ok || !data.scene) {
        throw new Error(data.message || 'DeepSeek không trả về cảnh hợp lệ.');
      }

      setScriptResult((current) => current ? {
        ...current,
        region,
        emotion,
        aspectRatio,
        scenes: current.scenes.map((item) => item.sceneNumber === scene.sceneNumber ? data.scene! : item)
      } : current);

      const next = { ...videoStatesRef.current };
      delete next[scene.sceneNumber];
      replaceVideoStates(next);
      clearFinalVideo();
      setNotice(`Đã viết lại cảnh ${scene.sceneNumber}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Không thể kết nối dịch vụ viết kịch bản.');
      setNotice('');
    } finally {
      setRewritingSceneNumber(null);
    }
  }

  function updateSceneField(sceneNumber: number, field: EditableSceneField, value: string) {
    setScriptResult((current) => current ? {
      ...current,
      scenes: current.scenes.map((scene) => scene.sceneNumber === sceneNumber ? { ...scene, [field]: value } : scene)
    } : current);

    const next = { ...videoStatesRef.current };
    delete next[sceneNumber];
    replaceVideoStates(next);
    clearFinalVideo();
  }

  async function copyVoiceover(scene: VideoScene) {
    try {
      await navigator.clipboard.writeText(scene.voiceover);
      setCopiedSceneNumber(scene.sceneNumber);
      window.setTimeout(() => setCopiedSceneNumber(null), 1500);
    } catch {
      setError('Không thể sao chép lời thoại trên trình duyệt này.');
    }
  }

  async function pollExistingVideoJob(sceneNumber: number, jobId: string) {
    while (mountedRef.current) {
      setOverallStatus(`Đang chờ xử lý cảnh ${sceneNumber}/${sceneCount}`);
      const response = await fetch(`/api/job?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
      const data = await readResponse<JobResponse>(response);

      if (!response.ok || !data.ok) throw new Error(data.error || 'Không kiểm tra được trạng thái tạo video.');

      const rawStatus = data.status || 'processing';
      const status = (
        ['pending', 'processing', 'running', 'completed', 'failed'].includes(rawStatus)
          ? rawStatus
          : 'processing'
      ) as SceneVideoState['status'];

      updateVideoState(sceneNumber, { status, videoUrl: data.videoUrl || undefined });

      if (status === 'completed') {
        if (!data.videoUrl) throw new Error('Video đã hoàn thành nhưng chưa có đường dẫn kết quả.');
        setOverallStatus(`Cảnh ${sceneNumber} đã hoàn thành`);
        return data.videoUrl;
      }

      if (status === 'failed') throw new Error(data.error || 'Tạo video thất bại.');
      await wait(5000);
    }

    throw new Error('Đã dừng theo dõi tiến trình tạo video.');
  }

  async function generateOneScene(sceneNumber: number) {
    if (!image || !scriptResult) throw new Error('Thiếu ảnh hoặc kịch bản.');

    const payload = mapScriptScenesToExistingVideoPayload(scriptResult)
      .find((item) => item.sceneNumber === sceneNumber);
    if (!payload) throw new Error(`Không tìm thấy dữ liệu cảnh ${sceneNumber}.`);

    setOverallStatus(`Đang tạo cảnh ${sceneNumber}/${sceneCount}`);
    updateVideoState(sceneNumber, { status: 'uploading', error: undefined, videoUrl: undefined, jobId: undefined });

    const formData = new FormData();
    formData.append('image', image);
    formData.append('script', payload.script);
    formData.append('model', payload.model);
    formData.append('aspectRatio', payload.aspectRatio);
    formData.append('region', payload.region);
    formData.append('emotion', payload.emotion);

    const response = await fetch('/api/generate', { method: 'POST', body: formData });
    const data = await readResponse<GenerateResponse>(response);

    if (!response.ok || !data.ok || !data.jobId) {
      throw new Error(data.message || `Không tạo được job cho cảnh ${sceneNumber}.`);
    }

    updateVideoState(sceneNumber, { status: 'created', jobId: data.jobId });
    return pollExistingVideoJob(sceneNumber, data.jobId);
  }

  function getCompletedUrls() {
    if (!scriptResult) return [];
    return scriptResult.scenes.map((scene) => videoStatesRef.current[scene.sceneNumber]?.videoUrl || '');
  }

  async function mergeCompletedVideos() {
    if (!scriptResult) return;
    const videoUrls = getCompletedUrls();

    if (videoUrls.length !== sceneCount || videoUrls.some((url) => !url)) {
      setVideoError('Chưa đủ video cảnh để ghép.');
      return;
    }

    setMergeState('merging');
    setVideoError('');
    setOverallStatus('Đang ghép video');
    setNotice('Tất cả cảnh đã hoàn thành. Hệ thống đang ghép video theo đúng thứ tự...');

    try {
      const response = await fetch('/api/video/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrls, aspectRatio })
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
          ? await response.json() as MergeErrorResponse
          : { message: await response.text() };
        throw new Error(data.message || 'Không thể ghép video.');
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error('File video ghép trả về bị rỗng.');

      clearFinalVideo();
      const objectUrl = URL.createObjectURL(blob);
      const fileName = makeVideoFileName();
      finalVideoUrlRef.current = objectUrl;
      setFinalVideoUrl(objectUrl);
      setFinalFileName(fileName);
      setMergeState('completed');
      setOverallStatus('Video hoàn chỉnh');
      setNotice('Video đã ghép thành công và đang được tải xuống thiết bị.');

      window.setTimeout(() => {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        if (mountedRef.current) setOverallStatus('Đã tải video xuống');
      }, 100);
    } catch (mergeError) {
      const message = mergeError instanceof Error ? mergeError.message : 'Không thể ghép video.';
      setMergeState('failed');
      setVideoError(message);
      setNotice('');
      setOverallStatus('Lỗi ghép video');
    }
  }

  async function createVideosWithExistingPipeline() {
    if (
      generationLockRef.current ||
      videoGenerating ||
      !image ||
      !scriptResult ||
      !isCompleteVideoScript(scriptResult, sceneCount)
    ) return;

    generationLockRef.current = true;
    setVideoGenerating(true);
    setVideoError('');
    setError('');
    clearFinalVideo();

    const payloads = mapScriptScenesToExistingVideoPayload(scriptResult);
    const initial = payloads.reduce<Record<number, SceneVideoState>>((all, payload) => {
      const previous = videoStatesRef.current[payload.sceneNumber];
      all[payload.sceneNumber] = previous?.status === 'completed' && previous.videoUrl
        ? previous
        : { sceneNumber: payload.sceneNumber, status: 'queued' };
      return all;
    }, {});
    replaceVideoStates(initial);

    try {
      for (const payload of payloads) {
        const existing = videoStatesRef.current[payload.sceneNumber];
        if (existing?.status === 'completed' && existing.videoUrl) continue;

        try {
          await generateOneScene(payload.sceneNumber);
        } catch (generationError) {
          const message = generationError instanceof Error ? generationError.message : 'Tạo video thất bại.';
          updateVideoState(payload.sceneNumber, { status: 'failed', error: message });
          setVideoError(`Cảnh ${payload.sceneNumber}: ${message}`);
          setNotice('Các cảnh đã hoàn thành vẫn được giữ lại. Hãy thử lại riêng cảnh bị lỗi.');
          setOverallStatus(`Cảnh ${payload.sceneNumber} bị lỗi`);
          return;
        }
      }

      setNotice('Đã hoàn thành toàn bộ cảnh. Chuẩn bị ghép video...');
      await mergeCompletedVideos();
    } finally {
      generationLockRef.current = false;
      if (mountedRef.current) setVideoGenerating(false);
    }
  }

  async function retryScene(sceneNumber: number) {
    if (
      generationLockRef.current ||
      videoGenerating ||
      !image ||
      !scriptResult ||
      !isCompleteVideoScript(scriptResult, sceneCount)
    ) return;

    generationLockRef.current = true;
    setVideoGenerating(true);
    setVideoError('');
    setError('');
    clearFinalVideo();

    try {
      await generateOneScene(sceneNumber);
      setNotice(`Cảnh ${sceneNumber} đã hoàn thành.`);

      const allCompleted = scriptResult.scenes.every((scene) => {
        const state = videoStatesRef.current[scene.sceneNumber];
        return state?.status === 'completed' && Boolean(state.videoUrl);
      });

      if (allCompleted) await mergeCompletedVideos();
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : 'Tạo video thất bại.';
      updateVideoState(sceneNumber, { status: 'failed', error: message });
      setVideoError(`Cảnh ${sceneNumber}: ${message}`);
      setOverallStatus(`Cảnh ${sceneNumber} bị lỗi`);
    } finally {
      generationLockRef.current = false;
      if (mountedRef.current) setVideoGenerating(false);
    }
  }

  function downloadFinalVideo() {
    if (!finalVideoUrl) return;
    setOverallStatus('Đang tải video xuống');
    const anchor = document.createElement('a');
    anchor.href = finalVideoUrl;
    anchor.download = finalFileName || makeVideoFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setOverallStatus('Đã tải video xuống');
  }

  function changeDuration(value: VideoDuration) {
    setVideoDuration(value);
    invalidateScriptForOptionChange();
  }

  function changeRegion(value: VideoRegion) {
    setRegion(value);
    invalidateScriptForOptionChange();
  }

  function changeEmotion(value: VideoEmotion) {
    setEmotion(value);
    invalidateScriptForOptionChange();
  }

  function changeAspectRatio(value: VideoAspectRatio) {
    setAspectRatio(value);
    invalidateScriptForOptionChange();
  }

  return (
    <main className={styles.pageShell}>
      <div className={styles.workspace}>
        <ControlsPanel
          hasImage={Boolean(image)}
          previewUrl={previewUrl}
          sourceContent={sourceContent}
          videoDuration={videoDuration}
          region={region}
          emotion={emotion}
          aspectRatio={aspectRatio}
          scriptLoading={scriptLoading}
          rewritingSceneNumber={rewritingSceneNumber}
          onImageChange={handleImageChange}
          onRemoveImage={removeImage}
          onSourceContentChange={setSourceContent}
          onVideoDurationChange={changeDuration}
          onRegionChange={changeRegion}
          onEmotionChange={changeEmotion}
          onAspectRatioChange={changeAspectRatio}
          onGenerateScript={generateFullScript}
        />

        <ResultPanel
          scriptResult={scriptResult}
          error={error}
          notice={notice}
          overallStatus={overallStatus}
          editingSceneNumber={editingSceneNumber}
          rewritingSceneNumber={rewritingSceneNumber}
          copiedSceneNumber={copiedSceneNumber}
          videoStates={videoStates}
          videoError={videoError}
          sceneCount={sceneCount as SceneCount}
          aspectRatio={aspectRatio}
          sourceContent={sourceContent}
          scriptLoading={scriptLoading}
          videoGenerating={videoGenerating}
          canCreateVideo={canCreateVideo}
          completedVideos={completedVideos}
          hasImage={Boolean(image)}
          mergeState={mergeState}
          finalVideoUrl={finalVideoUrl}
          finalFileName={finalFileName}
          onCopyScene={copyVoiceover}
          onToggleEditScene={(sceneNumber) => setEditingSceneNumber((current) => current === sceneNumber ? null : sceneNumber)}
          onRewriteScene={rewriteScene}
          onRetryScene={retryScene}
          onUpdateSceneField={updateSceneField}
          onRewriteAll={generateFullScript}
          onCreateVideos={createVideosWithExistingPipeline}
          onMergeVideos={mergeCompletedVideos}
          onDownloadFinal={downloadFinalVideo}
        />
      </div>
    </main>
  );
}
