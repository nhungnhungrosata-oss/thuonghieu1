import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin, authenticationErrorResponse, requireApiUser } from '../../../../lib/saas/auth';
import {
  completeVideoOutput,
  createVideoOutput,
  failVideoOutput,
  getOwnedRecord,
  markArchiveFailed,
  markArchived
} from '../../../../lib/saas/db';
import { downloadRemoteVideo, fetchStoredVideo, uploadVideo } from '../../../../lib/saas/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_SCENES = 6;
const MAX_SCENE_BYTES = 40 * 1024 * 1024;

function preparedFfmpegPath() {
  const executable = join(process.cwd(), '.ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (existsSync(executable)) return executable;
  throw new Error('Không tìm thấy FFmpeg đã chuẩn bị. Hãy chạy npm install hoặc redeploy không dùng cache.');
}

function runFfmpeg(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg kết thúc với mã ${code}.`));
    });
  });
}

function outputFilter(aspectRatio: '9:16' | '16:9') {
  return aspectRatio === '16:9'
    ? 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30'
    : 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30';
}

function safeFileName(title: string, outputId: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'personal-brand-video';
  return `${slug}-${outputId}.mp4`;
}

async function assertBufferSize(buffer: Buffer) {
  if (!buffer.length) throw new Error('Một cảnh video bị rỗng.');
  if (buffer.length > MAX_SCENE_BYTES) throw new Error('Một cảnh video vượt quá 40MB.');
  return buffer;
}

async function sceneBuffer(userId: string, generationId: string) {
  const generation = await getOwnedRecord('generations', userId, generationId);
  if (!generation || generation.status !== 'succeeded') {
    throw new Error('Một cảnh chưa hoàn thành hoặc không thuộc tài khoản này.');
  }

  if (generation.storage_status === 'archived' && generation.storage_bucket && generation.storage_path) {
    const response = await fetchStoredVideo(generation.storage_bucket, generation.storage_path);
    if (!response.ok) throw new Error('Không đọc được cảnh đã lưu.');
    return assertBufferSize(Buffer.from(await response.arrayBuffer()));
  }

  if (!generation.output_url) throw new Error('Cảnh không có file nguồn để ghép.');
  const buffer = await assertBufferSize(await downloadRemoteVideo(generation.output_url));
  try {
    const stored = await uploadVideo(`${userId}/scenes/${generation.id}.mp4`, buffer);
    await markArchived(generation.id, stored);
  } catch (error) {
    await markArchiveFailed(
      generation.id,
      error instanceof Error ? error.message : 'Không lưu được cảnh.'
    ).catch(() => undefined);
  }
  return buffer;
}

export async function POST(request: NextRequest) {
  let outputId = '';
  let workDir = '';
  try {
    assertSameOrigin(request);
    const { user } = await requireApiUser(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const generationIds = Array.isArray(body.generationIds)
      ? body.generationIds.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const aspectRatio: '9:16' | '16:9' = String(body.aspectRatio || '9:16') === '16:9' ? '16:9' : '9:16';
    const title = String(body.title || 'Video thương hiệu cá nhân').trim().slice(0, 200) || 'Video thương hiệu cá nhân';

    const sceneCount = generationIds.length;
    if (sceneCount < 2 || sceneCount > MAX_SCENES) {
      return NextResponse.json({ ok: false, message: `Cần từ 2 đến ${MAX_SCENES} cảnh để ghép.` }, { status: 400 });
    }

    const output = await createVideoOutput(user.id, aspectRatio, title);
    outputId = output.id;
    workDir = await mkdtemp(join(tmpdir(), 'personal-brand-video-'));

    const buffers: Buffer[] = [];
    for (const id of generationIds) buffers.push(await sceneBuffer(user.id, id));

    const inputFiles: string[] = [];
    for (let index = 0; index < buffers.length; index += 1) {
      const inputPath = join(workDir, `scene-${String(index + 1).padStart(2, '0')}.mp4`);
      await writeFile(inputPath, buffers[index]);
      inputFiles.push(inputPath);
    }

    const concatListPath = join(workDir, 'concat.txt');
    await writeFile(
      concatListPath,
      inputFiles.map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8'
    );

    const outputPath = join(workDir, 'output.mp4');
    await runFfmpeg(preparedFfmpegPath(), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
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
      '21',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ar',
      '48000',
      '-movflags',
      '+faststart',
      outputPath
    ]);

    const finalBuffer = await readFile(outputPath);
    if (!finalBuffer.length) throw new Error('Video sau khi ghép bị rỗng.');
    const stored = await uploadVideo(`${user.id}/outputs/${outputId}.mp4`, finalBuffer);
    await completeVideoOutput(outputId, stored);
    const fileName = safeFileName(title, outputId);

    return new Response(new Uint8Array(finalBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(finalBuffer.length),
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'X-Video-File-Name': fileName,
        'X-Video-Output-Id': outputId,
        'X-Video-Download-Url': `/api/outputs/${outputId}/download`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (outputId) {
      await failVideoOutput(
        outputId,
        error instanceof Error ? error.message : 'Ghép video thất bại.'
      ).catch(() => undefined);
    }
    if (error instanceof Error && error.name === 'AuthenticationError') {
      return authenticationErrorResponse(error);
    }
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Không ghép được video.' },
      { status: 500 }
    );
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
