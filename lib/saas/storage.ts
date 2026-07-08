import { isIP } from 'node:net';
import { getSupabaseConfig } from './config';

const MAX_VIDEO_BYTES = 120 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function allowedHosts() {
  const configured = process.env.VIDEO_SOURCE_HOSTS || '';
  const defaults = '.googleusercontent.com,.googlevideo.com,.useapi.net,.supabase.co,storage.googleapis.com';
  return `${defaults},${configured}`.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function validateRemoteUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') throw new Error('URL video nguồn phải dùng HTTPS.');
  if (isIP(host)) throw new Error('Không chấp nhận URL video bằng địa chỉ IP.');
  const matched = allowedHosts().some((allowed) => allowed.startsWith('.')
    ? host.endsWith(allowed)
    : host === allowed || host.endsWith(`.${allowed}`));
  if (!matched) throw new Error(`Domain video nguồn chưa được cho phép: ${host}.`);
  return url;
}

async function fetchWithValidatedRedirects(initialUrl: string, signal: AbortSignal) {
  let current = validateRemoteUrl(initialUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, { redirect: 'manual', cache: 'no-store', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirect === MAX_REDIRECTS) throw new Error('Video nguồn chuyển hướng quá nhiều lần.');
    const location = response.headers.get('location');
    if (!location) throw new Error('Video nguồn chuyển hướng nhưng thiếu địa chỉ đích.');
    current = validateRemoteUrl(new URL(location, current).toString());
  }
  throw new Error('Không thể tải video nguồn.');
}

export async function downloadRemoteVideo(remoteUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetchWithValidatedRedirects(remoteUrl, controller.signal);
    if (!response.ok) throw new Error(`Không tải được video nguồn: HTTP ${response.status}.`);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      throw new Error('Video nguồn trả về nội dung không phải file video.');
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_VIDEO_BYTES) throw new Error('Video nguồn vượt quá 120MB.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_VIDEO_BYTES) throw new Error('Kích thước video nguồn không hợp lệ.');
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadVideo(path: string, buffer: Buffer) {
  const { url, serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
  const bucket = process.env.VIDEO_STORAGE_BUCKET?.trim() || 'generated-videos';
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey!,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'video/mp4',
      'Cache-Control': '3600',
      'x-upsert': 'true'
    },
    body: new Uint8Array(buffer),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Không lưu được video: ${await response.text()}`);
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
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.message || 'Không tạo được signed URL.'));
  const signed = String(body.signedURL || body.signedUrl || '');
  if (!signed) throw new Error('Storage không trả signed URL.');
  return signed.startsWith('http') ? signed : `${url}/storage/v1${signed}`;
}

export async function fetchStoredVideo(bucket: string, path: string, range?: string | null) {
  const { url, serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
  const headers = new Headers({ apikey: serviceRoleKey!, Authorization: `Bearer ${serviceRoleKey}` });
  if (range) headers.set('Range', range);
  return fetch(`${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
    headers,
    cache: 'no-store'
  });
}

export async function removeStoredVideo(bucket: string, path: string) {
  const { url, serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
    method: 'DELETE',
    headers: { apikey: serviceRoleKey!, Authorization: `Bearer ${serviceRoleKey}` },
    cache: 'no-store'
  });
  if (!response.ok && response.status !== 404) throw new Error(`Không xóa được video: HTTP ${response.status}.`);
}
