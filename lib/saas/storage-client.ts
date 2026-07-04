import { getSupabaseConfig } from './config';

const DEFAULT_BUCKET = 'generated-videos';
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

function encodePath(path: string) {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function safeRemoteUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') throw new Error('URL video nguồn phải dùng HTTPS.');
  if (host === 'localhost' || host.endsWith('.local') || host === '127.0.0.1' || host === '::1') {
    throw new Error('URL video nguồn không hợp lệ.');
  }
  return url;
}

export async function downloadRemoteVideo(remoteUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(safeRemoteUrl(remoteUrl), {
      redirect: 'follow', cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) throw new Error(`Không tải được video nguồn: HTTP ${response.status}.`);
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_VIDEO_BYTES) throw new Error('Video nguồn vượt quá 200MB.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_VIDEO_BYTES) throw new Error('Kích thước video nguồn không hợp lệ.');
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadStoredVideo(path: string, buffer: Buffer) {
  const { url, serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
  const bucket = process.env.VIDEO_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey!,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true'
    },
    body: buffer,
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Không lưu được video dài hạn: ${await response.text()}`);
  return { bucket, path, sizeBytes: buffer.length };
}

export async function createSignedVideoUrl(bucket: string, path: string, expiresIn = 3600) {
  const { url, serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
  const response = await fetch(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey!,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn }),
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.message || 'Không tạo được liên kết tải video.'));
  const signedUrl = String(payload.signedURL || payload.signedUrl || '');
  if (!signedUrl) throw new Error('Storage phản hồi thiếu signed URL.');
  return signedUrl.startsWith('http') ? signedUrl : `${url}/storage/v1${signedUrl}`;
}

export async function removeStoredVideo(bucket: string, path: string) {
  const { url, serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
    method: 'DELETE',
    headers: { apikey: serviceRoleKey!, Authorization: `Bearer ${serviceRoleKey}` },
    cache: 'no-store'
  });
  if (!response.ok && response.status !== 404) throw new Error(`Không xóa được video hết hạn: HTTP ${response.status}.`);
}
