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

const PUBLIC_PATHS = ['/login', '/api/auth/session', '/auth/confirm', '/api/billing/webhook', '/api/cron/reconcile-generations'];
const QUOTAS: Record<string, { operation: string; limit: number; windowSeconds: number }> = {
  '/api/deepseek/script': { operation: 'deepseek_script', limit: 30, windowSeconds: 3600 },
  '/api/video/merge': { operation: 'video_merge', limit: 12, windowSeconds: 3600 },
  '/api/billing/checkout': { operation: 'billing_checkout', limit: 10, windowSeconds: 3600 }
};

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function unauthorized(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, message: 'Bạn cần đăng nhập để tiếp tục.' }, { status: 401 });
  }
  const url = new URL('/login', request.url);
  url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

async function consumeQuota(request: NextRequest, token: string) {
  const quota = request.method === 'POST' ? QUOTAS[request.nextUrl.pathname] : undefined;
  if (!quota) return true;
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/rpc/consume_api_quota`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_operation: quota.operation, p_limit: quota.limit, p_window_seconds: quota.windowSeconds }),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('Không kiểm tra được giới hạn API.');
  return Boolean(await response.json());
}

async function pass(request: NextRequest, user: AuthUser, token: string, session?: AuthSession) {
  if (!(await consumeQuota(request, token))) {
    return NextResponse.json(
      { ok: false, message: 'Bạn đã đạt giới hạn sử dụng trong giờ hiện tại.', retryAfter: 300 },
      { status: 429, headers: { 'Retry-After': '300' } }
    );
  }
  const headers = new Headers(request.headers);
  headers.set('x-saas-user-id', user.id);
  headers.set('x-saas-user-email', user.email);
  headers.set('x-saas-access-token', token);
  const response = NextResponse.next({ request: { headers } });
  if (session) setAuthCookies(response, session);
  return response;
}

export async function middleware(request: NextRequest) {
  if (isPublic(request.nextUrl.pathname)) return NextResponse.next();
  const access = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value || '';
  const refresh = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value || '';
  try {
    const user = await fetchAuthUser(access);
    if (user) return pass(request, user, access);
    const session = await refreshAuthSession(refresh);
    if (!session) return unauthorized(request);
    const refreshedUser = session.user?.id && session.user.email
      ? { id: session.user.id, email: session.user.email }
      : await fetchAuthUser(session.access_token);
    if (!refreshedUser) return unauthorized(request);
    return pass(request, refreshedUser, session.access_token, session);
  } catch {
    return NextResponse.json({ ok: false, message: 'SaaS chưa được cấu hình Supabase đầy đủ.' }, { status: 503 });
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)']
};
