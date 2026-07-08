import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  clearAuthCookies,
  setAuthCookies,
  type AuthSession,
  assertSameOrigin
} from '../../../../lib/saas/auth';
import { getSupabaseConfig } from '../../../../lib/saas/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function authError(response: Response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as Record<string, string>;
    return body.msg || body.message || body.error_description || text;
  } catch { return text || 'Không thể xác thực tài khoản.'; }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || '');
    const { url, anonKey } = getSupabaseConfig();

    if (action === 'logout') {
      const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value || '';
      if (token) await fetch(`${url}/auth/v1/logout`, {
        method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
      }).catch(() => undefined);
      const response = NextResponse.json({ ok: true });
      clearAuthCookies(response);
      return response;
    }

    if (action === 'adopt-session') {
      const access = String(body.accessToken || '');
      const refresh = String(body.refreshToken || '');
      if (!access || !refresh) return error('Phiên xác nhận email không hợp lệ.', 401);
      const userResponse = await fetch(`${url}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${access}` }, cache: 'no-store'
      });
      if (!userResponse.ok) return error('Phiên xác nhận đã hết hạn.', 401);
      const user = await userResponse.json() as { id?: string; email?: string };
      if (!user.id || !user.email) return error('Không đọc được tài khoản.', 401);
      const session: AuthSession = {
        access_token: access,
        refresh_token: refresh,
        expires_in: Math.max(60, Number(body.expiresIn || 3600)),
        user
      };
      const response = NextResponse.json({ ok: true });
      setAuthCookies(response, session);
      return response;
    }

    if (action !== 'login' && action !== 'signup') return error('Hành động không hợp lệ.');
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return error('Email không hợp lệ.');
    if (password.length < 8) return error('Mật khẩu phải có ít nhất 8 ký tự.');

    const endpoint = action === 'login'
      ? `${url}/auth/v1/token?grant_type=password`
      : `${url}/auth/v1/signup?redirect_to=${encodeURIComponent(`${(process.env.APP_URL || request.nextUrl.origin).replace(/\/$/, '')}/auth/confirm`)}`;
    const authResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store'
    });
    if (!authResponse.ok) {
      const message = await authError(authResponse);
      return error(message.toLowerCase().includes('invalid login') ? 'Email hoặc mật khẩu chưa đúng.' : message, 401);
    }
    const session = await authResponse.json() as AuthSession;
    if (!session.access_token || !session.refresh_token) {
      return NextResponse.json({ ok: true, requiresEmailConfirmation: true, message: 'Hãy kiểm tra email để xác nhận tài khoản.' });
    }
    const response = NextResponse.json({ ok: true });
    setAuthCookies(response, session);
    return response;
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : 'Lỗi xác thực.', 500);
  }
}
