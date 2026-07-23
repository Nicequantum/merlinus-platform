import { NextResponse } from 'next/server';
import { resolveAppSessionContext } from '@/lib/authBridge';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { clearApexSessionCookies } from '@/lib/apex/apexSession';
import { isApexPlatformMode } from '@/lib/platformMode';
import {
  buildSessionClearCookieHeader,
  clearSessionCookie,
  SESSION_COOKIE,
} from '@/lib/auth';
import { revokeActiveClerkSession } from '@/lib/clerkSession';
import { handleRouteError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { revokeAllSessionsForTechnician } from '@/lib/sessionRevocation';

async function performLogout(request: Request) {
  const { session, source } = await resolveAppSessionContext(request);

  if (session) {
    // Phase 6.2 — full fortress revocation on logout
    await revokeAllSessionsForTechnician(session.technicianId);
    await writeAuditedAccess({
      action: 'auth.logout',
      dealershipId: session.dealershipId,
      dealerId: auditDealerIdFromSession(session),
      technicianId: session.technicianId,
      ipAddress: getRequestIp(request),
      metadata: { authSource: source ?? 'unknown', sessionRevoked: true },
    });
    logger.info('auth.logout', {
      technicianId: session.technicianId,
      authSource: source ?? 'unknown',
    });
  } else {
    await clearSessionCookie();
  }

  await revokeActiveClerkSession();

  const response = NextResponse.json(
    { ok: true, session: null },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        'Set-Cookie': buildSessionClearCookieHeader(),
      },
    }
  );

  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    expires: new Date(0),
    path: '/',
  });

  if (isApexPlatformMode()) {
    clearApexSessionCookies(response);
  }

  return response;
}

export async function POST(request: Request) {
  const rateLimited = await checkRateLimit(request, 'auth.logout', RATE_LIMITS.default);
  if (rateLimited) return rateLimited;

  const { validateCsrfRequest } = await import('@/lib/csrf');
  const { apiError } = await import('@/lib/errors');
  const csrfError = validateCsrfRequest(request);
  if (csrfError) return apiError(csrfError, 403);

  try {
    return await performLogout(request);
  } catch (error) {
    return handleRouteError(error, 'auth.logout');
  }
}

/** M10: GET logout removed — CSRF via img/link prefetch must not clear sessions. */
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST /api/auth/logout.' },
    { status: 405, headers: { Allow: 'POST, DELETE' } }
  );
}

export async function DELETE(request: Request) {
  return POST(request);
}