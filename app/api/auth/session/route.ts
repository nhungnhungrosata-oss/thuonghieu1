import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  clearAuthCookies,
  setAuthCookies,
  type AuthSession
} from '../../../../lib/saas/auth';
import { getSupabaseConfig } from '../../../../lib/saas/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function readAuthError(response: Response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as { msg?: string; message?: string; error_description?: string };
    return payload.msg || payload.message || payload.error_description || 'Không thể xác thực tài khoản.';
  } catch {
    return text || 'Không thể xác thực tài khoản.';
  }
}

function normalizeInput(input: unknown) {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    action: String(value.action || '').trim(),
    email: String(value.email || '').trim().toLowerCase(),
    password: String(value.password || ''),
    accessToken: String(value.accessToken || ''),
    refreshToken: String(value.refreshToken || ''),
    expiresIn: Number(value.expiresIn || 3600)
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = normalizeInput(await request.json().catch(() => ({})));
    const { url, anonKey } = getSupabaseConfig();

    if (body.action === 'logout') {
      const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value || '';
      if (accessToken) {
        await fetch(`${url}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`
          },
          cache: 'no-store'
        }).catch(() => undefined);
      }
      const response = NextResponse.json({ ok: true });
      clearAuthCookies(response);
      return response;
    }

    if (body.action === 'adopt-session') {
      if (!body.accessToken || !body.refreshToken) return jsonError('Phiên xác nhận email không hợp lệ.', 401);
      const userResponse = await fetch(`${url}/auth/v1/user`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${body.accessToken}`
        },
        cache: 'no-store'
      });
      if (!userResponse.ok) return jsonError('Phiên xác nhận email đã hết hạn.', 401);
      const user = await userResponse.json() as { id?: string; email?: string };
      if (!user.id || !user.email) return jsonError('Không đọc được tài khoản vừa xác nhận.', 401);

      const session: AuthSession = {
        access_token: body.accessToken,
        refresh_token: body.refreshToken,
        expires_in: Math.max(60, body.expiresIn),
        user
      };
      const response = NextResponse.json({ ok: true, email: user.email });
      setAuthCookies(response, session);
      return response;
    }

    if (!['login', 'signup'].includes(body.action)) return jsonError('Hành động không hợp lệ.');
    if (!/^\S+@\S+\.\S+$/.test(body.email)) return jsonError('Email không hợp lệ.');
    if (body.password.length < 8) return jsonError('Mật khẩu phải có ít nhất 8 ký tự.');

    const endpoint = body.action === 'login'
      ? `${url}/auth/v1/token?grant_type=password`
      : `${url}/auth/v1/signup?redirect_to=${encodeURIComponent(`${request.nextUrl.origin}/auth/confirm`)}`;

    const authResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: 'no-store'
    });

    if (!authResponse.ok) {
      const rawMessage = await readAuthError(authResponse);
      const message = rawMessage.toLowerCase().includes('invalid login')
        ? 'Email hoặc mật khẩu chưa đúng.'
        : rawMessage;
      return jsonError(message, authResponse.status === 429 ? 429 : 401);
    }

    const session = await authResponse.json() as AuthSession;
    if (!session.access_token || !session.refresh_token) {
      return NextResponse.json({
        ok: true,
        requiresEmailConfirmation: true,
        message: 'Tài khoản đã được tạo. Hãy kiểm tra email để xác nhận rồi đăng nhập.'
      });
    }

    const response = NextResponse.json({ ok: true, email: session.user?.email || body.email });
    setAuthCookies(response, session);
    return response;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Lỗi xác thực không xác định.', 500);
  }
}
