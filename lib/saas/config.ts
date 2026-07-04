export type SupabaseConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
};

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, '');
}

export function getSupabaseConfig(options: { requireServiceRole?: boolean } = {}): SupabaseConfig {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey) {
    throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_ANON_KEY trong Environment Variables.');
  }

  if (options.requireServiceRole && !serviceRoleKey) {
    throw new Error('Thiếu SUPABASE_SERVICE_ROLE_KEY trong Environment Variables.');
  }

  return {
    url: normalizeUrl(url),
    anonKey,
    serviceRoleKey
  };
}
