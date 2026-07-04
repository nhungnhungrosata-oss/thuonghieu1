import { NextRequest, NextResponse } from 'next/server';
import { authenticationErrorResponse, requireApiUser } from '../../../../../lib/saas/auth';
import { getGenerationByIdForUser } from '../../../../../lib/saas/database-storage';
import { getSupabaseConfig } from '../../../../../lib/saas/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = { params: Promise<{ generationId: string }> };

function encodePath(path: string) {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireApiUser(request);
    const { generationId } = await context.params;
    const generation = await getGenerationByIdForUser(user.id, generationId);
    if (!generation) return NextResponse.json({ ok: false, message: 'Video không tồn tại.' }, { status: 404 });

    const bucket = String(generation.storage_bucket || '');
    const path = String(generation.storage_path || '');
    if (generation.storage_status !== 'archived' || !bucket || !path) {
      return NextResponse.json({ ok: false, message: 'Video chưa sẵn sàng hoặc đã hết hạn.' }, { status: 410 });
    }

    const { url, serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
    const source = await fetch(`${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
      headers: { apikey: serviceRoleKey!, Authorization: `Bearer ${serviceRoleKey}` },
      cache: 'no-store'
    });
    if (!source.ok || !source.body) return NextResponse.json({ ok: false, message: 'Không đọc được video lưu trữ.' }, { status: 502 });

    return new Response(source.body, {
      status: 200,
      headers: {
        'Content-Type': source.headers.get('content-type') || 'video/mp4',
        'Content-Length': source.headers.get('content-length') || '',
        'Content-Disposition': `inline; filename="video-${generationId}.mp4"`,
        'Cache-Control': 'private, max-age=300'
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') return authenticationErrorResponse(error);
    return NextResponse.json({ ok: false, message: 'Không thể tải video.' }, { status: 500 });
  }
}
