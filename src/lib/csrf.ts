/**
 * P1 CSRF — Double-submit protection for cookie-authenticated mutating APIs.
 *
 * Flow:
 *  1. Middleware (and login/session responses) set non-httpOnly cookie `merlin_csrf`.
 *  2. Browser JS reads the cookie and sends header `X-Merlin-CSRF` on POST/PUT/PATCH/DELETE.
 *  3. withAuth / withPublicRoute / bare session routes reject mismatches when enforced.
 *
 * Enforcement: **on by default** outside test/CI (not only production).
 * Disable only with MERLIN_CSRF_ENFORCE=false for local emergency debugging.
 *
 * Client code must import from `@/lib/csrfClient` (not this module).
 * Signature-validated public webhooks use skipCsrf / bare routes (not this path).
 */
import 'server-only';

import { randomBytes, timingSafeEqual } from 'crypto';
import type { NextResponse } from 'next/server';
import { CSRF_COOKIE, CSRF_HEADER } from '@/lib/csrfClient';

export { CSRF_COOKIE, CSRF_HEADER };

export const CSRF_ERROR =
  'Security check failed (CSRF). Refresh the page and try again.';

function isCiOrTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.CI === 'true' ||
    process.env.MERLIN_TEST_RUNTIME === '1'
  );
}

function isProductionEnv(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.MERLIN_PRODUCTION === '1' ||
    process.env.MERLIN_PRODUCTION === 'true'
  );
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Enforce CSRF on mutating methods outside test/CI.
 * Explicit MERLIN_CSRF_ENFORCE=true forces on even in odd runtimes;
 * false/off disables (ops escape hatch only).
 */
export function isCsrfEnforcementEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (isCiOrTestRuntime()) return false;
  const flag = env.MERLIN_CSRF_ENFORCE?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') return false;
  if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') return true;
  // Default: enforce in all non-test environments (dev, staging, production)
  return true;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingHttpMethod(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

function readCookieFromHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=') || '');
  }
  return null;
}

export function readCsrfTokenFromRequest(request: Request): {
  cookie: string | null;
  header: string | null;
} {
  const cookie = readCookieFromHeader(request.headers.get('cookie'), CSRF_COOKIE);
  // Accept canonical lower-case and display-case header names
  const header =
    request.headers.get(CSRF_HEADER)?.trim() ||
    request.headers.get('X-Merlin-CSRF')?.trim() ||
    null;
  return { cookie, header };
}

function tokensMatch(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Returns an error message when CSRF fails, or null when OK / not enforced / not mutating.
 */
export function validateCsrfRequest(
  request: Request,
  options?: { skipCsrf?: boolean; forceEnforce?: boolean }
): string | null {
  if (options?.skipCsrf) return null;
  if (!isMutatingHttpMethod(request.method)) return null;

  const enforce = options?.forceEnforce === true || isCsrfEnforcementEnabled();
  if (!enforce) return null;

  const { cookie, header } = readCsrfTokenFromRequest(request);
  if (!cookie || !header) {
    return CSRF_ERROR;
  }
  if (!tokensMatch(cookie, header)) {
    return CSRF_ERROR;
  }
  return null;
}

export function csrfCookieOptions(maxAgeSeconds = 60 * 60 * 8): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    // Must be readable by client JS for double-submit header
    httpOnly: false,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Attach CSRF cookie to a Route Handler response. */
export function applyCsrfCookieToResponse(
  response: NextResponse,
  token: string = generateCsrfToken()
): string {
  response.cookies.set(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}

/**
 * Prefer reusing existing token from the request cookie so client header stays valid
 * across session responses that re-set the cookie.
 */
export function applyCsrfCookieFromRequest(
  request: Request,
  response: NextResponse
): string {
  const existing = readCsrfTokenFromRequest(request).cookie;
  const token =
    existing && existing.length >= 16 ? existing : generateCsrfToken();
  return applyCsrfCookieToResponse(response, token);
}
