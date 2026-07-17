import { NextResponse } from 'next/server';
import {
  applyApexSessionCookies,
  rotateApexRefreshToken,
} from '@/lib/apex/apexSession';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { isLegacyAuthPathEnabled } from '@/lib/authMode';
import { isApexPlatformMode } from '@/lib/platformMode';
import { apiError, handleRouteError, UNAUTHORIZED_ERROR } from '@/lib/errors';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { logApiWriteRequest } from '@/lib/requestLogging';
import { toTechnicianSession } from '@/lib/sessionRefresh';

export async function POST(request: Request) {
  const startedAt = Date.now();
  const rateLimited = await checkRateLimit(request, 'auth.refresh', RATE_LIMITS.auth);
  if (rateLimited) return rateLimited;

  try {
    if (!isLegacyAuthPathEnabled()) {
      return apiError('Session refresh is disabled. Use Clerk sign-in.', 403);
    }

    if (!isApexPlatformMode()) {
      return apiError('Session refresh is only available in apex platform mode.', 404);
    }

    const rotation = await rotateApexRefreshToken(request);

    if (rotation.status === 'reuse_detected') {
      return apiError(UNAUTHORIZED_ERROR, 401);
    }

    if (rotation.status !== 'success') {
      return apiError(UNAUTHORIZED_ERROR, 401);
    }

    await writeAuditedAccess({
      action: 'auth.refresh',
      dealershipId: rotation.session.dealershipId,
      dealerId: auditDealerIdFromSession(rotation.session),
      technicianId: rotation.session.technicianId,
      entityType: 'technician',
      entityId: rotation.session.technicianId,
      ipAddress: getRequestIp(request),
      authSource: 'refresh',
      scopeMode: rotation.session.scopeMode ?? (rotation.session.role === 'owner' ? 'national' : 'dealership'),
    });

    const response = NextResponse.json({
      session: toTechnicianSession(rotation.session),
      authSource: rotation.authSource,
    });
    await applyApexSessionCookies(response, {
      accessToken: rotation.accessToken,
      refreshToken: rotation.refreshToken,
    });

    logApiWriteRequest({
      routeKey: 'auth.refresh',
      method: request.method,
      status: response.status,
      durationMs: Date.now() - startedAt,
      technicianId: rotation.session.technicianId,
      dealershipId: rotation.session.dealershipId,
    });
    return response;
  } catch (error) {
    logApiWriteRequest({
      routeKey: 'auth.refresh',
      method: request.method,
      status: 500,
      durationMs: Date.now() - startedAt,
      failed: true,
    });
    return handleRouteError(error, 'auth.refresh');
  }
}

/** Block refresh token rotation via GET (CSRF). */
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST /api/auth/refresh.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}