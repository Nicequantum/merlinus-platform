/**
 * P3-4 — Self-service password recovery (public, rate-limited).
 * Requires MERLIN_PASSWORD_RECOVERY_ENABLED=true.
 * Token is single-use, hashed at rest, short TTL.
 */

import { createHash, randomBytes } from 'crypto';
import { isCiOrTestRuntime } from '@/lib/rate-limit';

export const RECOVERY_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function isPasswordRecoveryEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = env.MERLIN_PASSWORD_RECOVERY_ENABLED?.trim().toLowerCase() ?? '';
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Return raw token in API response only for local/CI or explicit debug (never prod default). */
export function shouldReturnRecoveryTokenInResponse(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (isCiOrTestRuntime()) return true;
  const v = env.MERLIN_PASSWORD_RECOVERY_RETURN_TOKEN?.trim().toLowerCase() ?? '';
  return v === '1' || v === 'true' || v === 'yes';
}

export function generateRecoveryToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRecoveryToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

export const RECOVERY_GENERIC_MESSAGE =
  'If an account matches those details, a reset link was prepared. Contact your manager if you do not receive access within a few minutes.';
