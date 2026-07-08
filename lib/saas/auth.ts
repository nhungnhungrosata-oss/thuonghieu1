import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseConfig } from './config';

export const ACCESS_TOKEN_COOKIE = 'pv_access_token';
export const REFRESH_TOKEN_COOKIE = 'pv_refresh_token';

export type AuthUser = { id: string; email: string };
export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
};

export class AuthenticationError extends Error {
  constructor(message = 'Bạn cần đăng nhập để tiếp tục.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export async function fetchAuthUser(accessToken: string): Promise<AuthUser | null> {
  if (!accessToken) return null;
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    cache: 'no-store'
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string; email?: string };
  return user.id && user.email ? { id: user.id, email: user.email } : null;
}

export async function refreshAuthSession(refreshToken: string): Promise<AuthSession | null> {
  if (!refreshToken) return null;
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: 'no-store'
  });
  if (!response.ok) return null;
  const session = await response.json() as AuthSession;
  return session.access_token && session.refresh_token ? session : null;
}

export function setAuthCookies(response: NextResponse, session: AuthSession) {
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/'
  };
  response.cookies.set(ACCESS_TOKEN_COOKIE, session.access_token, {
    ...common,
    maxAge: Math.max(60, Number(session.expires_in || 3600))
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, session.refresh_token, {
    ...common,
    maxAge: 60 * 60 * 24 * 30
  });
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, '', { path: '/', maxAge: 0 });
  response.cookies.set(REFRESH_TOKEN_COOKIE, '', { path: '/', maxAge: 0 });
}

export async function requireApiUser(request: NextRequest) {
  const forwarded = request.headers.get('x-saas-access-token')?.trim();
  const accessToken = forwarded || request.cookies.get(ACCESS_TOKEN_COOKIE)?.value || '';
  const user = await fetchAuthUser(accessToken);
  if (!user) throw new AuthenticationError();
  return { user, accessToken };
}

export function authenticationErrorResponse(error: unknown) {
  return NextResponse.json(
    { ok: false, message: error instanceof Error ? error.message : 'Phiên đăng nhập không hợp lệ.' },
    { status: 401 }
  );
}

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) throw new Error('Nguồn yêu cầu không hợp lệ.');
}
