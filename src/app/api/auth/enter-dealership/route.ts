import { NextResponse } from 'next/server';
import { issueApexSessionCookies } from '@/lib/apex/apexSession';
import { ownerMayEnterDealership } from '@/lib/apex/dealerGroupAccess';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { buildOwnerDealershipSession } from '@/lib/apex/ownerDealershipContext';
import { getRlsDb, rlsContextFromSession, withRlsBypass } from '@/lib/apex/rlsContext';
import { resolveViewAsClaims } from '@/lib/apex/viewAs';
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
  enterDealershipSchema,
  parseRequestBody,
} from '@/lib/validation';

export async function POST(request: Request) {
  const startedAt = Date.now();
  const rateLimited = await checkRateLimit(request, 'auth.enter_dealership', RATE_LIMITS.auth);
  if (rateLimited) return rateLimited;

  try {
    if (!isLegacyAuthPathEnabled()) {
      return apiError('Enter dealership is disabled. Use Clerk sign-in.', 403);
    }

    if (!isApexPlatformMode()) {
      return apiError('Enter dealership is only available in apex platform mode.', 404);
    }

    return withAuth(
      request,
      async (session) => {
        const parsed = await parseRequestBody(request, enterDealershipSchema, AUTH_JSON_BODY_LIMIT_BYTES);
        if ('error' in parsed) return parsed.error;

        const dealershipId = parsed.data.dealershipId.trim();
        // Phase 6.1 least-privilege: never enter the national sentinel as a rooftop.
        if (dealershipId === APEX_NATIONAL_DEALERSHIP_ID) {
          return apiError('Cannot enter national sentinel as a dealership context.', 403);
        }

        const dealership = await withRlsBypass(async () =>
          getRlsDb().dealership.findUnique({
            where: { id: dealershipId },
            select: { id: true, name: true },
          })
        );

        if (!dealership) {
          return apiError('Dealership not found.', 404);
        }

        // PR-G2 — group owners may only enter rooftops in their DealerGroup(s)
        const allowed = await ownerMayEnterDealership(session.technicianId, dealership.id);
        if (!allowed) {
          return apiError('You do not have access to this dealership.', 403);
        }

        const uiRole = parsed.data.viewAsRole ?? 'dealership_owner';
        const lens = resolveViewAsClaims({
          role: uiRole,
          serviceAdvisorId: parsed.data.viewAsServiceAdvisorId,
        });

        const ownerSession = await buildOwnerDealershipSession(session.technicianId, dealership.id, {
          viewAsRole: lens.viewAsRole,
          viewAsAdmin: lens.viewAsAdmin,
          viewAsServiceAdvisorId: lens.viewAsServiceAdvisorId,
        });
        if (!ownerSession) {
          if (uiRole === 'service_advisor') {
            return apiError(
              'No active service advisor found for this rooftop (or invalid advisor id).',
              400
            );
          }
          return apiError('Unable to enter dealership context.', 403);
        }

        await writeAuditedAccess(
          {
            action: 'owner.dealership_enter',
            dealershipId: dealership.id,
            dealerId: auditDealerIdFromSession(ownerSession),
            technicianId: session.technicianId,
            entityType: 'dealership',
            entityId: dealership.id,
            ipAddress: getRequestIp(request),
            authSource: 'legacy',
            scopeMode: 'dealership',
            metadata: {
              previousScopeMode: session.scopeMode ?? 'national',
              dealershipName: dealership.name,
              dealerGroupId: ownerSession.activeDealerGroupId ?? null,
              viewAsRole: ownerSession.viewAsRole ?? 'dealership_owner',
              viewAsAdmin: Boolean(ownerSession.viewAsAdmin),
            },
          },
          { rls: { ...rlsContextFromSession(ownerSession), enforced: true } }
        );

        // Phase 6.2 — drop prior refresh families so national-scope tokens cannot rotate
        await revokeApexRefreshForScopeSwitch(session.technicianId);

        const response = NextResponse.json({
          session: toTechnicianSession(ownerSession),
          scopeMode: 'dealership' as const,
          activeDealershipId: dealership.id,
          dealershipName: dealership.name,
        });
        await issueApexSessionCookies(response, ownerSession, request, { authSource: 'legacy' });

        logApiWriteRequest({
          routeKey: 'auth.enter_dealership',
          method: request.method,
          status: response.status,
          durationMs: Date.now() - startedAt,
          technicianId: session.technicianId,
          dealershipId: dealership.id,
        });
        return response;
      },
      {
        requireOwner: true,
        // Phase 6.4 / G2 — must be platform national or group home before entering a rooftop
        requireOwnerNational: true,
        rateLimitKey: 'auth.enter_dealership',
        skipRateLimit: true,
      }
    );
  } catch (error) {
    logApiWriteRequest({
      routeKey: 'auth.enter_dealership',
      method: request.method,
      status: 500,
      durationMs: Date.now() - startedAt,
      failed: true,
    });
    return handleRouteError(error, 'auth.enter_dealership');
  }
}