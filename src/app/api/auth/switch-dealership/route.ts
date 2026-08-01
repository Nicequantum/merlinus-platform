/**
 * POST /api/auth/switch-dealership
 *
 * Authenticated multi-membership staff switch between rooftops (second facility)
 * without full re-login. Owners use enter-dealership (A→B switch) instead.
 */
import { NextResponse } from 'next/server';
import { issueApexSessionCookies } from '@/lib/apex/apexSession';
import { resolveSelectDealershipSession } from '@/lib/apex/selectDealership';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { isLegacyAuthPathEnabled } from '@/lib/authMode';
import { apiError, handleRouteError } from '@/lib/errors';
import { isApexPlatformMode } from '@/lib/platformMode';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { logApiWriteRequest } from '@/lib/requestLogging';
import { revokeApexRefreshForScopeSwitch } from '@/lib/sessionRevocation';
import { toTechnicianSession } from '@/lib/sessionRefresh';
import {
  AUTH_JSON_BODY_LIMIT_BYTES,
  parseRequestBody,
  switchDealershipSchema,
} from '@/lib/validation';

export async function POST(request: Request) {
  const startedAt = Date.now();
  const rateLimited = await checkRateLimit(request, 'auth.switch_dealership', RATE_LIMITS.auth);
  if (rateLimited) return rateLimited;

  const { validateCsrfRequest } = await import('@/lib/csrf');
  const csrfError = validateCsrfRequest(request);
  if (csrfError) return apiError(csrfError, 403);

  try {
    if (!isLegacyAuthPathEnabled()) {
      return apiError('Dealership switch is disabled. Use Clerk sign-in.', 403);
    }

    if (!isApexPlatformMode()) {
      return apiError('Dealership switch is only available in apex platform mode.', 404);
    }

    return withAuth(
      request,
      async (session) => {
        if (session.isOwner || session.role === 'owner') {
          return apiError(
            'Owners switch rooftops via enter-dealership (or exit then enter).',
            400
          );
        }

        const parsed = await parseRequestBody(
          request,
          switchDealershipSchema,
          AUTH_JSON_BODY_LIMIT_BYTES
        );
        if ('error' in parsed) return parsed.error;

        const nextSession = await resolveSelectDealershipSession({
          technicianId: session.technicianId,
          dealershipId: parsed.data.dealershipId,
          rememberAsDefault: parsed.data.rememberAsDefault,
        });

        if (!nextSession) {
          return apiError('No active membership for that dealership.', 403);
        }

        await writeAuditedAccess({
          action: 'auth.switch_dealership',
          dealershipId: nextSession.dealershipId,
          dealerId: auditDealerIdFromSession(nextSession),
          technicianId: session.technicianId,
          entityType: 'dealership',
          entityId: nextSession.dealershipId,
          ipAddress: getRequestIp(request),
          authSource: 'legacy',
          scopeMode: 'dealership',
          metadata: {
            previousDealershipId: session.activeDealershipId ?? session.dealershipId,
            rememberAsDefault: Boolean(parsed.data.rememberAsDefault),
          },
        });

        await revokeApexRefreshForScopeSwitch(session.technicianId);

        const response = NextResponse.json({
          session: toTechnicianSession(nextSession),
          scopeMode: 'dealership' as const,
          activeDealershipId: nextSession.dealershipId,
        });
        await issueApexSessionCookies(response, nextSession, request, { authSource: 'legacy' });

        logApiWriteRequest({
          routeKey: 'auth.switch_dealership',
          method: request.method,
          status: response.status,
          durationMs: Date.now() - startedAt,
          technicianId: session.technicianId,
          dealershipId: nextSession.dealershipId,
        });
        return response;
      },
      {
        rateLimitKey: 'auth.switch_dealership',
        skipRateLimit: true,
        useRls: false,
      }
    );
  } catch (error) {
    logApiWriteRequest({
      routeKey: 'auth.switch_dealership',
      method: request.method,
      status: 500,
      durationMs: Date.now() - startedAt,
      failed: true,
    });
    return handleRouteError(error, 'auth.switch_dealership');
  }
}
