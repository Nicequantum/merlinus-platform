import { NextResponse } from 'next/server';
import { INVALID_CREDENTIALS_MESSAGE } from '@/lib/apex/credentialType';
import {
  consumePendingSelectionToken,
  issueApexSessionCookies,
  verifyPendingSelectionToken,
} from '@/lib/apex/apexSession';
import { resolveSelectDealershipSession } from '@/lib/apex/selectDealership';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { isLegacyAuthPathEnabled } from '@/lib/authMode';
import { isApexPlatformMode } from '@/lib/platformMode';
import { apiError, handleRouteError } from '@/lib/errors';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { logApiWriteRequest } from '@/lib/requestLogging';
import { revokeApexRefreshForScopeSwitch } from '@/lib/sessionRevocation';
import {
  AUTH_JSON_BODY_LIMIT_BYTES,
  parseRequestBody,
  selectDealershipSchema,
} from '@/lib/validation';

export async function POST(request: Request) {
  const startedAt = Date.now();
  const rateLimited = await checkRateLimit(request, 'auth.select_dealership', RATE_LIMITS.auth);
  if (rateLimited) return rateLimited;

  const { validateCsrfRequest } = await import('@/lib/csrf');
  const csrfError = validateCsrfRequest(request);
  if (csrfError) return apiError(csrfError, 403);

  try {
    if (!isLegacyAuthPathEnabled()) {
      return apiError('Dealership selection is disabled. Use Clerk sign-in.', 403);
    }

    if (!isApexPlatformMode()) {
      return apiError('Dealership selection is only available in apex platform mode.', 404);
    }

    const parsed = await parseRequestBody(request, selectDealershipSchema, AUTH_JSON_BODY_LIMIT_BYTES);
    if ('error' in parsed) {
      return parsed.error;
    }

    const { pendingToken, dealershipId, rememberAsDefault } = parsed.data;
    const pendingClaims = await verifyPendingSelectionToken(pendingToken);
    if (!pendingClaims) {
      return apiError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    const consumed = await consumePendingSelectionToken(pendingToken);
    if (!consumed) {
      return apiError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    const session = await resolveSelectDealershipSession({
      technicianId: pendingClaims.technicianId,
      dealershipId,
      rememberAsDefault,
    });

    if (!session) {
      return apiError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    await writeAuditedAccess({
      action: 'auth.select_dealership',
      dealershipId: session.dealershipId,
      dealerId: auditDealerIdFromSession(session),
      technicianId: session.technicianId,
      entityType: 'dealership',
      entityId: session.dealershipId,
      ipAddress: getRequestIp(request),
      authSource: 'legacy',
      scopeMode: 'dealership',
      metadata: {
        credentialType: pendingClaims.credentialType,
        rememberAsDefault: Boolean(rememberAsDefault),
      },
    });

    // Phase 6.3 — drop any prior pending/other refresh families before issuing rooftop cookies
    await revokeApexRefreshForScopeSwitch(session.technicianId);

    const response = NextResponse.json({
      session,
      authSource: 'legacy' as const,
      credentialType: pendingClaims.credentialType,
    });
    await issueApexSessionCookies(response, session, request, { authSource: 'legacy' });

    logApiWriteRequest({
      routeKey: 'auth.select_dealership',
      method: request.method,
      status: response.status,
      durationMs: Date.now() - startedAt,
      technicianId: session.technicianId,
      dealershipId: session.dealershipId,
    });
    return response;
  } catch (error) {
    logApiWriteRequest({
      routeKey: 'auth.select_dealership',
      method: request.method,
      status: 500,
      durationMs: Date.now() - startedAt,
      failed: true,
    });
    return handleRouteError(error, 'auth.select_dealership');
  }
}