import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSupabaseConfig } from './config';

type RecoveryPayload = {
  userId: string;
  generationId: string;
  jobId: string;
  expiresAt: number;
};

function signingSecret() {
  const { serviceRoleKey } = getSupabaseConfig({ requireServiceRole: true });
  return serviceRoleKey!;
}

function signature(value: string) {
  return createHmac('sha256', signingSecret()).update(value).digest('base64url');
}

export function createJobRecoveryToken(input: Omit<RecoveryPayload, 'expiresAt'>, ttlSeconds = 6 * 60 * 60) {
  const payload: RecoveryPayload = {
    ...input,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

export function verifyJobRecoveryToken(token: string, expected: Omit<RecoveryPayload, 'expiresAt'>) {
  const [encoded, suppliedSignature, ...extra] = token.split('.');
  if (!encoded || !suppliedSignature || extra.length) return false;

  const expectedSignature = signature(encoded);
  const actualBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as RecoveryPayload;
    return payload.userId === expected.userId
      && payload.generationId === expected.generationId
      && payload.jobId === expected.jobId
      && Number.isFinite(payload.expiresAt)
      && payload.expiresAt >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
