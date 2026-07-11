import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  fetchAuthUser,
  refreshAuthSession,
  setAuthCookies,
  type AuthSession,
  type AuthUser
} from './lib/saas/auth';
import { getSupabaseConfig } from './lib/saas/config';

const PUBLIC_PATHS = ['/login', '/api/auth/session', '/auth/confirm'];
const API_QUOTAS: Record<string, { operation: string; limit: number; windowSeconds: number }> = {
  '/api/deepseek/script': { operation: 'deepseek_script', limit: 30, windowSeconds: 3600 },
  '/api/video/merge': { operation: 'video_merge', limit: 12, windowSeconds: 3600 }
};

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

async function consumeApiQuota(request: NextRequest, accessToken: string) {
  const quota = request.method === 'POST' ? API_QUOTAS[request.nextUrl.pathname] : undefined;
  if (!quota) return true;

  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/rpc/consume_api_quota`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_operation: quota.operation,
      p_limit: quota.limit,
      p_window_seconds: quota.windowSeconds
    }),
    cache: 'no-store'
  });

  if (!response.ok) throw new Error('Không kiểm tra được giới hạn API.');
  return Boolean(await response.json());
}

async function authorizedResponse(
  request: NextRequest,
  user: AuthUser,
  accessToken: string,
  refreshedSession?: AuthSession
) {
  const allowed = await consumeApiQuota(request, accessToken);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, message: 'Bạn đã đạt giới hạn sử dụng tính năng này trong giờ hiện tại.', retryAfter: 300 },
      { status: 429, headers: { 'Retry-After': '300' } }
    );
  }

  const headers = new Headers(request.headers);
  headers.set('x-saas-user-id', user.id);
  headers.set('x-saas-user-email', user.email);
  headers.set('x-saas-access-token', accessToken);
  const response = NextResponse.next({ request: { headers } });
  if (refreshedSession) setAuthCookies(response, refreshedSession);
  return response;
}

export async function middleware(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value || '';
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value || '';

  try {
    const user = await fetchAuthUser(accessToken);
    if (user) return authorizedResponse(request, user, accessToken);

    const refreshed = await refreshAuthSession(refreshToken);
    if (!refreshed?.access_token) return unauthenticatedResponse(request);

    const refreshedUser = refreshed.user?.id && refreshed.user?.email
      ? { id: refreshed.user.id, email: refreshed.user.email }
      : await fetchAuthUser(refreshed.access_token);
    if (!refreshedUser) return unauthenticatedResponse(request);

    return authorizedResponse(request, refreshedUser, refreshed.access_token, refreshed);
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
