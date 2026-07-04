import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  fetchAuthUser,
  refreshAuthSession,
  setAuthCookies
} from './lib/saas/auth';

const PUBLIC_PATHS = ['/login', '/api/auth/session', '/auth/confirm'];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function unauthenticatedResponse(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { ok: false, message: 'Bạn cần đăng nhập để tiếp tục.' },
      { status: 401 }
    );
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value || '';
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value || '';

  try {
    const user = await fetchAuthUser(accessToken);
    if (user) {
      const headers = new Headers(request.headers);
      headers.set('x-saas-user-id', user.id);
      headers.set('x-saas-user-email', user.email);
      headers.set('x-saas-access-token', accessToken);
      return NextResponse.next({ request: { headers } });
    }

    const refreshed = await refreshAuthSession(refreshToken);
    if (!refreshed?.access_token) return unauthenticatedResponse(request);

    const refreshedUser = refreshed.user?.id && refreshed.user?.email
      ? { id: refreshed.user.id, email: refreshed.user.email }
      : await fetchAuthUser(refreshed.access_token);
    if (!refreshedUser) return unauthenticatedResponse(request);

    const headers = new Headers(request.headers);
    headers.set('x-saas-user-id', refreshedUser.id);
    headers.set('x-saas-user-email', refreshedUser.email);
    headers.set('x-saas-access-token', refreshed.access_token);
    const response = NextResponse.next({ request: { headers } });
    setAuthCookies(response, refreshed);
    return response;
  } catch {
    return NextResponse.json(
      { ok: false, message: 'SaaS chưa được cấu hình Supabase đầy đủ.' },
      { status: 503 }
    );
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'
  ]
};
