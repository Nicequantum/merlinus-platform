/**
 * Browser-safe CSRF helpers (no Node crypto / server-only imports).
 * Server validation lives in `@/lib/csrf`.
 */

export const CSRF_COOKIE = 'merlin_csrf';
export const CSRF_HEADER = 'x-merlin-csrf';

/** Read CSRF token from document.cookie (browser only). */
export function readCsrfTokenFromDocument(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`)
  );
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
