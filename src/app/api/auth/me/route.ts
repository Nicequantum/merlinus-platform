import { NextResponse } from 'next/server';
import { resolveAppSessionContext } from '@/lib/authBridge';
import { applyCsrfCookieFromRequest } from '@/lib/csrf';
import { getDb } from '@/lib/db';
import { handleRouteError } from '@/lib/errors';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { jsonWithSessionCookie, toTechnicianSession } from '@/lib/sessionRefresh';

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request, 'auth.me', RATE_LIMITS.default);
  if (rateLimited) return rateLimited;

  try {
    // Workers: bind D1 before session DB lookup (no filesystem Prisma engine).
    await getDb();
    const { session, jwtPayload, source } = await resolveAppSessionContext(request);
    if (!session) {
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