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

function normalizeClientToken(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  if (!s) return undefined;
  try {
    if (s.includes('%')) s = decodeURIComponent(s);
  } catch {
    // keep
  }
  return s.trim() || undefined;
}

/** Read CSRF token from document.cookie (browser only). Prefer last matching cookie. */
export function readCsrfTokenFromDocument(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const parts = document.cookie.split(';');
  let found: string | undefined;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${CSRF_COOKIE}=`)) continue;
    const value = trimmed.slice(CSRF_COOKIE.length + 1);
    try {
      found = normalizeClientToken(decodeURIComponent(value)) ?? normalizeClientToken(value);
    } catch {
      found = normalizeClientToken(value);
    }
  }
  return found && found.length >= 16 ? found : undefined;
}

/** Write readable CSRF cookie so document.cookie and next requests stay aligned. */
export function writeCsrfCookieClient(token: string): void {
  if (typeof document === 'undefined') return;
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  // Match middleware: 8h, path=/, SameSite=Lax, not HttpOnly
  document.cookie = `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${
    60 * 60 * 8
  }; SameSite=Lax${secure}`;
}

function generateClientToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Ensure a CSRF token exists (cookie + return value for header).
 * Seeds via GET /api/auth/csrf when missing; falls back to client-generated token.
 */
export async function ensureCsrfToken(): Promise<string> {
  let token = readCsrfTokenFromDocument();
  if (token && token.length >= 16) {
    writeCsrfCookieClient(token); // re-assert attributes
    return token;
  }

  try {
    const res = await fetch('/api/auth/csrf', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { token?: string };
      const fromApi = normalizeClientToken(body.token);
      if (fromApi && fromApi.length >= 16) {
        writeCsrfCookieClient(fromApi);
        return fromApi;
      }
    }
  } catch {
    // fall through to client seed
  }

  // Final fallback: client-minted token written as cookie (double-submit still holds).
  token = generateClientToken();
  writeCsrfCookieClient(token);
  return token;
}

/**
 * Merge CSRF double-submit header into request headers.
 * Pass `tokenOverride` when you already called ensureCsrfToken() (preferred).
 */
export function withCsrfHeaders(
  headers?: HeadersInit,
  tokenOverride?: string | null
): HeadersInit {
  const csrf = normalizeClientToken(tokenOverride) || readCsrfTokenFromDocument();
  if (!csrf) return headers || {};
  if (headers instanceof Headers) {
    const next = new Headers(headers);
    next.set(CSRF_HEADER, csrf);
    return next;
  }
  if (Array.isArray(headers)) {
    const filtered = headers.filter(([k]) => k.toLowerCase() !== CSRF_HEADER);
    return [...filtered, [CSRF_HEADER, csrf]];
  }
  const record = { ...(headers || {}) } as Record<string, string>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === CSRF_HEADER) delete record[key];
  }
  record[CSRF_HEADER] = csrf;
  return record;
}

/** Apply CSRF onto a Headers instance (mutates). */
export function applyCsrfHeaderToHeaders(headers: Headers, tokenOverride?: string): void {
  const csrf = normalizeClientToken(tokenOverride) || readCsrfTokenFromDocument();
  if (csrf) {
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
  applyCsrfHeaderToHeaders(headers);
  return headers;
}
