import { NextResponse } from 'next/server';
import { issueApexSessionCookies } from '@/lib/apex/apexSession';
import { listOwnerDealerGroupMemberships } from '@/lib/apex/dealerGroupAccess';
import { buildOwnerGroupSession, buildOwnerNationalSession } from '@/lib/apex/ownerDealershipContext';
import { isPlatformOperator } from '@/lib/apex/platformOperator';
import { rlsContextFromSession } from '@/lib/apex/rlsContext';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { isApexPlatformMode } from '@/lib/platformMode';
import { getRequestIp } from '@/lib/rate-limit';
import { revokeApexRefreshForScopeSwitch } from '@/lib/sessionRevocation';
import { toTechnicianSession } from '@/lib/sessionRefresh';
import {
  AUTH_JSON_BODY_LIMIT_BYTES,
  parseRequestBody,
} from '@/lib/validation';
import { z } from 'zod';

const selectDealerGroupSchema = z.object({
  /** Target group id, or null / "__national__" for platform national home (operators only). */
  dealerGroupId: z.string().min(1).nullable().optional(),
});

/**
 * Phase 7.3 — switch active DealerGroup portfolio (or national home for platform operators).
 */
export async function POST(request: Request) {
  if (!isApexPlatformMode()) {
    return apiError('Select dealer group is only available in apex platform mode.', 404);
  }

  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(
        request,
        selectDealerGroupSchema,
        AUTH_JSON_BODY_LIMIT_BYTES
      );
      if ('error' in parsed) return parsed.error;

      const rawId = parsed.data.dealerGroupId?.trim() || null;
      const wantNational = !rawId || rawId === '__national__' || rawId === 'national';

      let ownerSession;
      if (wantNational) {
        if (!(await isPlatformOperator(session.technicianId))) {
          return apiError('Only platform operators can open the national portfolio.', 403);
        }
        ownerSession = await buildOwnerNationalSession(session.technicianId);
      } else {
        const memberships = await listOwnerDealerGroupMemberships(session.technicianId);
        const allowed = memberships.some((m) => m.dealerGroupId === rawId);
        if (!allowed && !(await isPlatformOperator(session.technicianId))) {
          return apiError('You do not have access to this dealer group.', 403);
        }
        // Platform operators may switch into any group they have membership for;
        // if operator without membership, still deny (groups are membership-scoped).
        if (!allowed) {
          return apiError('You do not have access to this dealer group.', 403);
        }
        ownerSession = await buildOwnerGroupSession(session.technicianId, rawId!);
      }

      if (!ownerSession) {
        return apiError('Unable to switch dealer group context.', 403);
      }

      await revokeApexRefreshForScopeSwitch(session.technicianId);

      await writeAuditedAccess(
        {
          action: 'owner.national_access',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'dealer_group',
          entityId: ownerSession.activeDealerGroupId || 'national',
          ipAddress: getRequestIp(request),
          scopeMode: ownerSession.scopeMode ?? 'national',
          metadata: {
            switchTo: ownerSession.scopeMode,
            dealerGroupId: ownerSession.activeDealerGroupId ?? null,
            previousGroupId: session.activeDealerGroupId ?? null,
          },
        },
        { rls: { ...rlsContextFromSession(session), enforced: true } }
      );

      const response = NextResponse.json({
        ok: true,
        scopeMode: ownerSession.scopeMode,
        activeDealerGroupId: ownerSession.activeDealerGroupId ?? null,
        dealerGroupName: ownerSession.dealerGroupName ?? null,
        session: toTechnicianSession(ownerSession),
      });
      await issueApexSessionCookies(response, ownerSession, request, {
        authSource: 'legacy',
      });
      return response;
    },
    {
      requireOwner: true,
      requireOwnerNational: true,
      rateLimitKey: 'owner.select_dealer_group',
      rateLimit: { limit: 20, windowMs: 60_000 },
    }
  );
}
