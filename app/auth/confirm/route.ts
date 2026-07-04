import { NextRequest, NextResponse } from 'next/server';
import { AuthSession, setAuthCookies } from '../../../lib/saas/auth';
import { getSupabaseConfig } from '../../../lib/saas/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')?.trim();
  const type = request.nextUrl.searchParams.get('type')?.trim();
  const next = request.nextUrl.searchParams.get('next') || '/';
  const loginUrl = new URL('/login', request.url);

  if (!tokenHash || !type) {
    loginUrl.searchParams.set('error', 'Liên kết xác nhận không hợp lệ.');
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { url, anonKey } = getSupabaseConfig();
    const response = await fetch(`${url}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token_hash: tokenHash, type }),
      cache: 'no-store'
    });

    if (!response.ok) {
      loginUrl.searchParams.set('error', 'Liên kết xác nhận đã hết hạn hoặc không hợp lệ.');
      return NextResponse.redirect(loginUrl);
    }

    const session = await response.json() as AuthSession;
    if (!session.access_token || !session.refresh_token) {
      loginUrl.searchParams.set('notice', 'Email đã được xác nhận. Hãy đăng nhập.');
      return NextResponse.redirect(loginUrl);
    }

    const destination = new URL(next.startsWith('/') ? next : '/', request.url);
    const redirect = NextResponse.redirect(destination);
    setAuthCookies(redirect, session);
    return redirect;
  } catch {
    loginUrl.searchParams.set('error', 'Không thể xác nhận tài khoản lúc này.');
    return NextResponse.redirect(loginUrl);
  }
}
