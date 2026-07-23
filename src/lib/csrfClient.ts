/**
 * Browser-safe CSRF helpers (no Node crypto / server-only imports).
 * Server validation lives in `@/lib/csrf`.
 *
 * Double-submit: cookie `merlin_csrf` (readable) + header `X-Merlin-CSRF` on mutations.
 */

export const CSRF_COOKIE = 'merlin_csrf';
/** Canonical header name (HTTP is case-insensitive; Fetch normalizes). */
export const CSRF_HEADER = 'x-merlin-csrf';
/** Human-facing / docs alias */
export const CSRF_HEADER_DISPLAY = 'X-Merlin-CSRF';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingHttpMethodClient(method: string | undefined): boolean {
  return MUTATING.has((method || 'GET').toUpperCase());
}

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

/**
 * Merge CSRF double-submit header into request headers when the cookie is present.
 * Safe for GET (harmless) and required for POST/PUT/PATCH/DELETE under enforcement.
 */
export function withCsrfHeaders(headers?: HeadersInit): HeadersInit {
  const csrf = readCsrfTokenFromDocument();
  if (!csrf) return headers || {};
  if (headers instanceof Headers) {
    const next = new Headers(headers);
    if (!next.has(CSRF_HEADER)) next.set(CSRF_HEADER, csrf);
    return next;
  }
  if (Array.isArray(headers)) {
    const has = headers.some(([k]) => k.toLowerCase() === CSRF_HEADER);
    return has ? headers : [...headers, [CSRF_HEADER, csrf]];
  }
  const record = { ...(headers || {}) } as Record<string, string>;
  const existingKey = Object.keys(record).find((k) => k.toLowerCase() === CSRF_HEADER);
  if (!existingKey) {
    record[CSRF_HEADER] = csrf;
  }
  return record;
}

/** Apply CSRF onto a Headers instance (mutates). */
export function applyCsrfHeaderToHeaders(headers: Headers): void {
  const csrf = readCsrfTokenFromDocument();
  if (csrf && !headers.has(CSRF_HEADER)) {
    headers.set(CSRF_HEADER, csrf);
  }
}

/**
 * Build RequestInit headers for browser fetch with credentials + CSRF for mutations.
 */
export function browserFetchHeaders(
  init?: RequestInit,
  extra?: HeadersInit
): Headers {
  const headers = new Headers(init?.headers || undefined);
  if (extra) {
    const extraHeaders = new Headers(extra);
    extraHeaders.forEach((v, k) => headers.set(k, v));
  }
  if (isMutatingHttpMethodClient(init?.method)) {
    applyCsrfHeaderToHeaders(headers);
  } else {
    // Still attach when cookie exists — cheap and helps half-open clients.
    applyCsrfHeaderToHeaders(headers);
  }
  return headers;
}
