import { NextResponse } from 'next/server';
import {
  APEX_REFRESH_COOKIE,
  applyApexSessionCookies,
  rotateApexRefreshToken,
} from '@/lib/apex/apexSession';
import { resolveAppSessionContext } from '@/lib/authBridge';
import { isLegacyAuthPathEnabled } from '@/lib/authMode';
import { applyCsrfCookieFromRequest } from '@/lib/csrf';
import { getDb } from '@/lib/db';
import { handleRouteError } from '@/lib/errors';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { jsonWithSessionCookie, toTechnicianSession } from '@/lib/sessionRefresh';

function requestHasRefreshCookie(request: Request): boolean {
  const header = request.headers.get('cookie') || '';
  return header.includes(`${APEX_REFRESH_COOKIE}=`);
}

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request, 'auth.me', RATE_LIMITS.default);
  if (rateLimited) return rateLimited;

  try {
    // Workers: bind D1 before session DB lookup (no filesystem Prisma engine).
    await getDb();
    const { session, jwtPayload, source } = await resolveAppSessionContext(request);
    if (!session) {
      // Silent refresh: access JWT may have expired after idle while refresh cookie is still valid.
      // This is the primary fix for "pick up phone after idle → must sign in again".
      if (isLegacyAuthPathEnabled() && requestHasRefreshCookie(request)) {
        const rotation = await rotateApexRefreshToken(request);
        if (rotation.status === 'success') {
          const response = NextResponse.json({
            session: toTechnicianSession(rotation.session),
            authSource: 'refresh' as const,
          });
          applyCsrfCookieFromRequest(request, response);
          await applyApexSessionCookies(response, {
            accessToken: rotation.accessToken,
            refreshToken: rotation.refreshToken,
          });
          return response;
        }
      }

      const unauth = NextResponse.json({ session: null, authSource: null }, { status: 401 });
      // Seed CSRF cookie even when unauthenticated so login POST can double-submit.
      applyCsrfCookieFromRequest(request, unauth);
      return unauth;
    }

    return jsonWithSessionCookie(
      { session: toTechnicianSession(session), authSource: source },
      session,
      jwtPayload
    );
  } catch (error) {
    return handleRouteError(error, 'auth.me');
  }
}
