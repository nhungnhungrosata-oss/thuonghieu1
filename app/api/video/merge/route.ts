import { spawn } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { NextRequest, NextResponse } from 'next/server';
import { isVideoAspectRatio, type VideoAspectRatio } from '../../../../lib/video-script';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_CLIPS = 6;
const MAX_CLIP_BYTES = 35 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 90_000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

function isBlockedHostname(hostname: string) {
  const value = hostname.toLowerCase();
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value === '::1') {
    return true;
  }

  const match = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const octets = match.slice(1).map(Number);
  if (octets.some((item) => item < 0 || item > 255)) return true;
  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function parseRemoteVideoUrl(value: unknown) {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || isBlockedHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function downloadClip(url: URL, destination: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`Không tải được một cảnh video (HTTP ${response.status}).`);
    }

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_CLIP_BYTES) {
      throw new Error('Một cảnh video vượt quá giới hạn dung lượng ghép.');
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error('Một cảnh video tải về bị rỗng.');
    if (bytes.byteLength > MAX_CLIP_BYTES) throw new Error('Một cảnh video vượt quá giới hạn dung lượng ghép.');

    await writeFile(destination, bytes);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Tải cảnh video mất quá nhiều thời gian.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

let cachedFfmpegExecutable = '';

async function resolveFfmpegExecutable() {
  if (cachedFfmpegExecutable) return cachedFfmpegExecutable;

  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    process.env.FFMPEG_PATH,
    path.join(process.cwd(), '.ffmpeg', binaryName),
    ffmpegPath || undefined,
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', binaryName),
    process.platform === 'win32' ? undefined : '/usr/local/bin/ffmpeg',
    process.platform === 'win32' ? undefined : '/usr/bin/ffmpeg'
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, fsConstants.F_OK);

      if (process.platform !== 'win32') {
        try {
          await chmod(candidate, 0o755);
        } catch {
          // File trong serverless bundle có thể chỉ đọc; tiếp tục kiểm tra quyền chạy.
        }
        await access(candidate, fsConstants.X_OK);
      }

      cachedFfmpegExecutable = candidate;
      return candidate;
    } catch {
      // Thử đường dẫn tiếp theo.
    }
  }

  throw new Error(
    'Không tìm thấy FFmpeg trong bản deploy. Hãy redeploy sau khi cài dependency để Vercel đóng gói thư mục .ffmpeg.'
  );
}

async function runFfmpeg(args: string[]) {
  const executable = await resolveFfmpegExecutable();

  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error('FFmpeg chưa được đóng gói trong Vercel Function. Vui lòng redeploy bản mã nguồn mới.'));
        return;
      }
      if (error.code === 'EACCES') {
        reject(new Error('FFmpeg không có quyền thực thi trên máy chủ.'));
        return;
      }
      reject(error);
    });

    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg kết thúc với mã ${code}.`));
    });
  });
}

function outputFilter(aspectRatio: VideoAspectRatio) {
  return aspectRatio === '16:9'
    ? 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30'
    : 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30';
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return jsonError('Dữ liệu ghép video không hợp lệ.', 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError('Dữ liệu ghép video không hợp lệ.', 400);
  }

  const aspectRatio = body.aspectRatio;
  const videoUrls = body.videoUrls;

  if (!isVideoAspectRatio(aspectRatio)) {
    return jsonError('Tỷ lệ video không hợp lệ.', 400);
  }

  if (!Array.isArray(videoUrls) || videoUrls.length < 2 || videoUrls.length > MAX_CLIPS) {
    return jsonError(`Cần từ 2 đến ${MAX_CLIPS} cảnh video để ghép.`, 400);
  }

  const urls = videoUrls.map(parseRemoteVideoUrl);
  if (urls.some((url) => !url)) {
    return jsonError('Đường dẫn một cảnh video không hợp lệ.', 400);
  }

  const workspace = await mkdtemp(path.join(tmpdir(), 'personal-brand-video-'));

  try {
    const clipPaths: string[] = [];
    for (let index = 0; index < urls.length; index += 1) {
      const clipPath = path.join(workspace, `scene-${String(index + 1).padStart(2, '0')}.mp4`);
      await downloadClip(urls[index]!, clipPath);
      clipPaths.push(clipPath);
    }

    const concatListPath = path.join(workspace, 'concat.txt');
    const concatList = clipPaths.map((clipPath) => `file '${clipPath}'`).join('\n');
    await writeFile(concatListPath, concatList, 'utf8');

    const outputPath = path.join(workspace, 'personal-brand-video.mp4');
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-vf',
      outputFilter(aspectRatio),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-movflags',
      '+faststart',
      '-y',
      outputPath
    ]);

    const video = await readFile(outputPath);
    if (!video.length) throw new Error('Video sau khi ghép bị rỗng.');

    return new Response(new Uint8Array(video), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(video.length),
        'Content-Disposition': `attachment; filename="personal-brand-video-${Date.now()}.mp4"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Không thể ghép video.', 500);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
