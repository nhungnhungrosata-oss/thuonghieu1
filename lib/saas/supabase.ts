import { getSupabaseConfig } from './config';

export async function parseSupabaseError(response: Response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { message?: string; error_description?: string; hint?: string };
    return data.message || data.error_description || data.hint || text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

export async function adminRequest(path: string, init: RequestInit = {}) {
  const { url, serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
  const headers = new Headers(init.headers);
  headers.set('apikey', serviceRoleKey!);
  headers.set('Authorization', `Bearer ${serviceRoleKey}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${url}/rest/v1/${path}`, { ...init, headers, cache: 'no-store' });
}

export async function userRpc(accessToken: string, functionName: string, body: Record<string, unknown>) {
  const { url, anonKey } = getSupabaseConfig();
  return fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    cache: 'no-store'
  });
}
