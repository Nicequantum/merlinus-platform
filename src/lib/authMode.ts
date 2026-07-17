/**
 * Phase 4 Clerk — auth mode configuration (no server-only deps; safe for unit tests).
 *
 * AUTH_MODE controls which identity providers are active:
 * - legacy: D7 + password JWT only (default when unset — Merlinus backward compatible)
 * - dual:   Clerk when session present, else legacy JWT
 * - clerk:  Clerk only (legacy login disabled)
 */

export const AUTH_MODES = ['legacy', 'dual', 'clerk'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export function parseAuthMode(raw: string | undefined | null): AuthMode {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return 'legacy';
  if ((AUTH_MODES as readonly string[]).includes(normalized)) {
    return normalized as AuthMode;
  }
  throw new Error(`Invalid AUTH_MODE "${raw}" — expected legacy, dual, or clerk`);
}

export function getAuthMode(): AuthMode {
  return parseAuthMode(process.env.AUTH_MODE);
}

export function clerkEnvConfigured(): boolean {
  return Boolean(
    process.env.CLERK_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  );
}

/** True when resolveAppSession should attempt Clerk before legacy JWT. */
export function isClerkAuthPathEnabled(): boolean {
  const mode = getAuthMode();
  if (mode === 'legacy') return false;
  return clerkEnvConfigured();
}

/** True when legacy JWT session resolution remains allowed. */
export function isLegacyAuthPathEnabled(): boolean {
  return getAuthMode() !== 'clerk';
}