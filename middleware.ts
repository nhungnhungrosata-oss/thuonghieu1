import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './lib/saas/auth';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/session',
  '/auth/confirm',
  '/api/billing/webhook',
  '/api/cron/reconcile-generations'
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function hasSessionCookie(request: NextRequest) {
  return Boolean(
    request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ||
    request.cookies.get(REFRESH_TOKEN_COOKIE)?.value
  );
}

function unauthorized(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, message: 'Bạn cần đăng nhập để tiếp tục.' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export function middleware(request: NextRequest) {
  if (isPublic(request.nextUrl.pathname)) return NextResponse.next();
  if (!hasSessionCookie(request)) return unauthorized(request);

  // Không gọi Supabase hoặc API ngoài trong Edge Middleware.
  // Các API Node.js như /api/generate, /api/job, /api/video/merge sẽ tự xác thực
  // bằng HttpOnly cookie qua requireApiUser để tránh lỗi Vercel MIDDLEWARE_INVOCATION_FAILED.
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'
  ]
};
