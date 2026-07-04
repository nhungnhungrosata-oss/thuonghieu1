import { NextRequest, NextResponse } from 'next/server';
import { authenticationErrorResponse, requireApiUser } from '../../../../../lib/saas/auth';
import { getOwnedRecord } from '../../../../../lib/saas/db';
import { fetchStoredVideo } from '../../../../../lib/saas/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Context = { params: Promise<{ outputId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { user } = await requireApiUser(request);
    const { outputId } = await context.params;
    const record = await getOwnedRecord('video_outputs', user.id, outputId);
    if (!record) return NextResponse.json({ ok: false, message: 'Video không tồn tại.' }, { status: 404 });
    if (record.status !== 'succeeded' || !record.storage_bucket || !record.storage_path) {
      return NextResponse.json({ ok: false, message: 'Video chưa sẵn sàng hoặc đã hết hạn.' }, { status: 410 });
    }
    const source = await fetchStoredVideo(record.storage_bucket, record.storage_path, request.headers.get('range'));
    if (!source.ok || !source.body) return NextResponse.json({ ok: false, message: 'Không đọc được video.' }, { status: 502 });
    const headers = new Headers({
      'Content-Type': source.headers.get('content-type') || 'video/mp4',
      'Content-Disposition': `attachment; filename="personal-brand-${outputId}.mp4"`,
      'Cache-Control': 'private, max-age=300'
    });
    const length = source.headers.get('content-length');
    const contentRange = source.headers.get('content-range');
    const acceptRanges = source.headers.get('accept-ranges');
    if (length) headers.set('Content-Length', length);
    if (contentRange) headers.set('Content-Range', contentRange);
    if (acceptRanges) headers.set('Accept-Ranges', acceptRanges);
    return new Response(source.body, { status: source.status, headers });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') return authenticationErrorResponse(error);
    return NextResponse.json({ ok: false, message: 'Không thể tải video.' }, { status: 500 });
  }
}
