'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type GenerateResponse = {
  ok: boolean;
  jobId?: string;
  mediaGenerationId?: string;
  message?: string;
  raw?: unknown;
};

type JobResponse = {
  ok: boolean;
  status?: string;
  videoUrl?: string;
  mediaGenerationId?: string;
  error?: string;
  raw?: unknown;
};

const defaultScript = 'Xin chào mọi người, hôm nay tôi sẽ chia sẻ một mẹo sức khỏe đơn giản, dễ áp dụng mỗi ngày.';
const MAX_CLIENT_IMAGE_SIZE = 4 * 1024 * 1024;

async function readResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (contentType.includes('application/json')) {
    return JSON.parse(text || '{}') as T;
  }

  return {
    ok: false,
    message: text || `Request failed with HTTP ${res.status}`,
    error: text || `Request failed with HTTP ${res.status}`,
    raw: { rawText: text, status: res.status, statusText: res.statusText }
  } as T;
}

function formatFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

export default function HomePage() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [script, setScript] = useState(defaultScript);
  const [model, setModel] = useState('veo-3.1-lite');
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState('Chưa tạo');
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const [raw, setRaw] = useState<unknown>(null);
  const pollingRef = useRef<number | null>(null);

  const canSubmit = useMemo(() => Boolean(image && script.trim() && !submitting), [image, script, submitting]);

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
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, []);

  async function pollJob(id: string) {
    const res = await fetch(`/api/job?jobId=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const data = await readResponse<JobResponse>(res);
    setRaw(data.raw ?? data);

    if (!res.ok || !data.ok) {
      setError(data.error || 'Không kiểm tra được trạng thái job.');
      setStatus('Lỗi');
      if (pollingRef.current) window.clearInterval(pollingRef.current);
      return;
    }

    setStatus(data.status || 'Đang xử lý');

    if (data.videoUrl) {
      setVideoUrl(data.videoUrl);
    }

    if (data.status === 'completed') {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    }

    if (data.status === 'failed') {
      setError(data.error || 'Tạo video thất bại.');
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    }
  }

  async function startPolling(id: string) {
    if (pollingRef.current) window.clearInterval(pollingRef.current);
    await pollJob(id);
    pollingRef.current = window.setInterval(() => pollJob(id), 5000);
  }

  function handleImageChange(file: File | null) {
    setError('');
    setImage(null);

    if (!file) return;

    if (file.size > MAX_CLIENT_IMAGE_SIZE) {
      setError(`Ảnh đang là ${formatFileSize(file.size)}. Vui lòng nén ảnh xuống dưới 4MB trước khi upload.`);
      return;
    }

    setImage(file);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!image) return;

    setSubmitting(true);
    setError('');
    setVideoUrl('');
    setJobId('');
    setStatus('Đang upload ảnh...');
    setRaw(null);

    try {
      const formData = new FormData();
      formData.append('image', image);
      formData.append('script', script);
      formData.append('model', model);

      const res = await fetch('/api/generate', {
        method: 'POST',
        body: formData
      });

      const data = await readResponse<GenerateResponse>(res);
      setRaw(data.raw ?? data);

      if (!res.ok || !data.ok || !data.jobId) {
        throw new Error(data.message || 'Không tạo được job video.');
      }

      setJobId(data.jobId);
      setStatus('Đã gửi job, đang tạo video...');
      await startPolling(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi không xác định.');
      setStatus('Lỗi');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <span className="badge">MVP · Google Flow qua UseAPI · Video 8 giây</span>
        <h1>Tạo video từ ảnh nhân vật</h1>
        <p>Upload 1 ảnh, nhập lời thoại/ngữ cảnh, hệ thống sẽ gọi UseAPI để upload ảnh lên Google Flow rồi tạo video dọc 8 giây.</p>
      </section>

      <section className="grid">
        <form className="card" onSubmit={handleSubmit}>
          <h2>1. Nhập đầu vào</h2>

          <div className="field">
            <label htmlFor="image">Ảnh nhân vật</label>
            <input
              id="image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => handleImageChange(event.target.files?.[0] ?? null)}
            />
            <div className="helper">Hỗ trợ PNG/JPG/WEBP, tối đa 4MB. Nên dùng ảnh rõ mặt, ánh sáng tốt, 9:16 hoặc chân dung.</div>
            {previewUrl && (
              <div className="preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Ảnh xem trước" />
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="script">Nội dung/lời thoại</label>
            <textarea
              id="script"
              value={script}
              onChange={(event) => setScript(event.target.value)}
              placeholder="Nhập nội dung muốn nhân vật nói hoặc hành động trong video 8 giây..."
            />
            <div className="helper">Video 8 giây nên dùng khoảng 18–26 từ tiếng Việt để tự nhiên hơn.</div>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="model">Model</label>
              <select id="model" value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="veo-3.1-lite">veo-3.1-lite</option>
                <option value="veo-3.1-fast">veo-3.1-fast</option>
                <option value="veo-3.1-quality">veo-3.1-quality</option>
              </select>
              <div className="helper">Mặc định dùng Veo 3.1 Lite để tiết kiệm credit và phù hợp tài khoản freemium hơn.</div>
            </div>

            <div className="field">
              <label>Thời lượng</label>
              <input value="8 giây · portrait" readOnly />
            </div>
          </div>

          <button className="btn" type="submit" disabled={!canSubmit}>
            {submitting ? 'Đang gửi...' : 'Tạo video 8 giây'}
          </button>

          <p className="footer-note">Token UseAPI nằm ở server/Vercel Environment Variables, không lộ ra trình duyệt.</p>
        </form>

        <aside className="card status">
          <h2>2. Kết quả</h2>

          <div className="status-box">
            <div className="status-title">
              <strong>Trạng thái</strong>
              <span className={`pill ${status === 'completed' ? 'ok' : status === 'Lỗi' || status === 'failed' ? 'err' : ''}`}>{status}</span>
            </div>
            {jobId && <div className="small">Job ID: {jobId}</div>}
          </div>

          {error && <div className="status-box error">{error}</div>}

          {videoUrl && (
            <div className="status-box">
              <video src={videoUrl} controls playsInline />
              <div style={{ height: 12 }} />
              <a className="download" href={videoUrl} target="_blank" rel="noreferrer">
                Mở / tải video
              </a>
            </div>
          )}

          <div className="status-box">
            <strong>Quy trình app đang chạy</strong>
            <ol className="steps">
              <li>Upload ảnh lên UseAPI assets.</li>
              <li>Lấy mediaGenerationId của ảnh.</li>
              <li>Gửi yêu cầu tạo video với startImage.</li>
              <li>Nhận jobId và tự kiểm tra mỗi 5 giây.</li>
              <li>Khi completed thì hiện video.</li>
            </ol>
          </div>

          {raw ? (
            <details className="status-box">
              <summary>Debug response</summary>
              <pre className="small">{JSON.stringify(raw, null, 2)}</pre>
            </details>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
