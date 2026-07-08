import { NextRequest, NextResponse } from 'next/server';
import { authenticationErrorResponse, requireApiUser } from '../../../lib/saas/auth';
import { accountSnapshot } from '../../../lib/saas/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireApiUser(request);
    const data = await accountSnapshot(user.id);
    return NextResponse.json({ ok: true, user, ...data });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') return authenticationErrorResponse(error);
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Không đọc được tài khoản.' }, { status: 500 });
  }
}
