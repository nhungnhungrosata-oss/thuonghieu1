import { chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

if (!ffmpegPath) {
  throw new Error('ffmpeg-static không trả về đường dẫn binary cho nền tảng hiện tại.');
}

const targetDirectory = path.join(process.cwd(), '.ffmpeg');
const targetPath = path.join(targetDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

await mkdir(targetDirectory, { recursive: true });
await copyFile(ffmpegPath, targetPath);

if (process.platform !== 'win32') {
  await chmod(targetPath, 0o755);
}

console.log(`[prepare-ffmpeg] FFmpeg đã được chuẩn bị tại ${targetPath}`);
