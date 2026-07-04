import { NextRequest, NextResponse } from 'next/server';
import { authenticationErrorResponse, requireApiUser } from '../../../lib/saas/auth';
import { getAccountSnapshotV2 } from '../../../lib/saas/account-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireApiUser(request);
    const snapshot = await getAccountSnapshotV2(user.id);
    return NextResponse.json({
      ok: true,
      user,
      profile: snapshot.profile,
      generations: snapshot.generations,
      payments: snapshot.payments
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthenticationError') return authenticationErrorResponse(error);
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Không đọc được tài khoản.' },
      { status: 500 }
    );
  }
}
