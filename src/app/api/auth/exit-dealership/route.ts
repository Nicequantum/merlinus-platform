import { NextResponse } from 'next/server';
import { issueApexSessionCookies } from '@/lib/apex/apexSession';
import { buildOwnerHomeSession } from '@/lib/apex/ownerDealershipContext';
import { rlsContextFromSession } from '@/lib/apex/rlsContext';
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

export async function POST(request: Request) {
  const startedAt = Date.now();
  const rateLimited = await checkRateLimit(request, 'auth.exit_dealership', RATE_LIMITS.auth);
  if (rateLimited) return rateLimited;

  try {
    if (!isLegacyAuthPathEnabled()) {
      return apiError('Exit dealership is disabled. Use Clerk sign-in.', 403);
    }

    if (!isApexPlatformMode()) {
      return apiError('Exit dealership is only available in apex platform mode.', 404);
    }

    return withAuth(
      request,
      async (session) => {
        if (session.scopeMode !== 'dealership') {
          return apiError('Not currently in dealership scope.', 400);
        }

        const previousDealershipId = session.activeDealershipId ?? session.dealershipId;
        // PR-G2 — return to group home when member, else platform national
        const ownerSession = await buildOwnerHomeSession(session.technicianId);
        if (!ownerSession) {
          return apiError('Unable to exit dealership context.', 403);
        }

        const homeScope = ownerSession.scopeMode === 'group' ? 'group' : 'national';

        await writeAuditedAccess(
          {
            action: 'owner.dealership_exit',
            dealershipId: previousDealershipId,
            dealerId: auditDealerIdFromSession(session),
            technicianId: session.technicianId,
            entityType: 'dealership',
            entityId: previousDealershipId,
            ipAddress: getRequestIp(request),
            authSource: 'legacy',
            scopeMode: homeScope,
            metadata: {
              previousDealershipId,
              previousDealershipName: session.dealershipName,
              homeScopeMode: homeScope,
              dealerGroupId: ownerSession.activeDealerGroupId ?? null,
              previousViewAsRole: session.viewAsRole ?? 'dealership_owner',
              previousViewAsAdmin: Boolean(session.viewAsAdmin),
            },
          },
          { rls: { ...rlsContextFromSession(ownerSession), enforced: true } }
        );

        // Phase 6.2 — drop dealership-scope refresh families before home re-issue
        await revokeApexRefreshForScopeSwitch(session.technicianId);

        const response = NextResponse.json({
          session: toTechnicianSession(ownerSession),
          scopeMode: homeScope,
        });
        await issueApexSessionCookies(response, ownerSession, request, { authSource: 'legacy' });

        logApiWriteRequest({
          routeKey: 'auth.exit_dealership',
          method: request.method,
          status: response.status,
          durationMs: Date.now() - startedAt,
          technicianId: session.technicianId,
          dealershipId: previousDealershipId,
        });
        return response;
      },
      { requireOwner: true, rateLimitKey: 'auth.exit_dealership', skipRateLimit: true }
    );
  } catch (error) {
    logApiWriteRequest({
      routeKey: 'auth.exit_dealership',
      method: request.method,
      status: 500,
      durationMs: Date.now() - startedAt,
      failed: true,
    });
    return handleRouteError(error, 'auth.exit_dealership');
  }
}