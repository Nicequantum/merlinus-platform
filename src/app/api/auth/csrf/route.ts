/**
 * GET /api/auth/csrf
 * Seeds / returns double-submit CSRF token for browser mutations (owner onboard, etc.).
 * Intentional bare: rate-limited, no session required; sets non-httpOnly merlin_csrf cookie.
 */
import { NextResponse } from 'next/server';
import {
  applyCsrfCookieToResponse,
  generateCsrfToken,
  readCsrfTokenFromRequest,
} from '@/lib/csrf';
import { CSRF_COOKIE } from '@/lib/csrfClient';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, 'auth.csrf', {
    ...RATE_LIMITS.default,
    limit: 60,
  });
  if (limited) return limited;

  const existing = readCsrfTokenFromRequest(request).cookie;
  const token =
    existing && existing.length >= 16 ? existing : generateCsrfToken();

  const response = NextResponse.json(
    {
      ok: true,
      cookie: CSRF_COOKIE,
      token,
      header: 'X-Merlin-CSRF',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
  applyCsrfCookieToResponse(response, token);
  return response;
}
