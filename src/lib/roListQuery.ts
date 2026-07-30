import 'server-only';

import type { Prisma } from '@prisma/client';
import { withOptionalDealerId } from '@/lib/apex/dealerScope';
import { scopedPiiWhere, type TenantScopedSession } from '@/lib/apex/tenantScope';
import { effectiveRole, effectiveServiceAdvisorId } from '@/lib/apex/viewAs';
import {
  getStartOfDealershipDay,
  resolveDealershipTimezone,
} from '@/lib/dealershipDayBoundary';
import { buildRoNumberSearchQueryTokens } from '@/lib/piiSearchToken';
import { repairOrderListQuerySchema } from '@/lib/validation';

export type RepairOrderListScope = 'today' | 'previous';

export interface RepairOrderListParams {
  scope: RepairOrderListScope;
  limit: number;
  cursor?: string;
  /** Case-insensitive search across RO number and vehicle fields. */
  q?: string;
}

export function parseRepairOrderListParams(url: URL): RepairOrderListParams {
  const raw = Object.fromEntries(url.searchParams.entries());
  return repairOrderListQuerySchema.parse(raw);
}

export function buildRepairOrderListWhere(
  session: TenantScopedSession & {
    technicianId: string;
    serviceAdvisorId?: string | null;
    dealershipTimezone?: string | null;
  },
  params: RepairOrderListParams
): Prisma.RepairOrderWhereInput {
  const piiScope = scopedPiiWhere(session);
  const role = effectiveRole(session);
  const advisorId = effectiveServiceAdvisorId(session);
  const roleWhere: Prisma.RepairOrderWhereInput = withOptionalDealerId(
    role === 'manager'
      ? { dealershipId: piiScope.dealershipId }
      : role === 'service_advisor' && advisorId
        ? {
            dealershipId: piiScope.dealershipId,
            serviceAdvisorId: advisorId,
          }
        : role === 'owner'
          ? // Native dealership-owner lens: rooftop-wide visibility (same as manager list)
            { dealershipId: piiScope.dealershipId }
          : { dealershipId: piiScope.dealershipId, technicianId: session.technicianId },
    piiScope.dealerId
  );

  if (params.q) {
    // Bound length — long OCR junk in `q` + many OR LIKE clauses trips D1 pattern limits.
    const term = params.q.trim().slice(0, 64);
    if (term) {
      const roSearchTokens = buildRoNumberSearchQueryTokens(term);
      // Hex HMAC tokens are safe for LIKE (no `_`/`%`). Cap to a few secrets max.
      const safeTokens = roSearchTokens.slice(0, 4);
      // Vehicle free-text: strip LIKE wildcards so user input cannot explode D1.
      const vehicleTerm = term
        .replace(/[%_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 32);
      const orClauses: Prisma.RepairOrderWhereInput[] = [];
      for (const token of safeTokens) {
        orClauses.push({ roNumberSearchTokens: { contains: token } });
      }
      if (vehicleTerm.length >= 1) {
        orClauses.push(
          { year: { contains: vehicleTerm } },
          { make: { contains: vehicleTerm } },
          { model: { contains: vehicleTerm } }
        );
      }
      if (orClauses.length === 0) {
        return { ...roleWhere, id: '__no_search_match__' };
      }
      return {
        ...roleWhere,
        OR: orClauses,
      };
    }
  }

  const tz = resolveDealershipTimezone(session.dealershipTimezone);
  const startOfToday = getStartOfDealershipDay(new Date(), tz);
  if (params.scope === 'previous') {
    return {
      ...roleWhere,
      updatedAt: { lt: startOfToday },
    };
  }

  // Today's active work — touched since dealership-local midnight.
  return {
    ...roleWhere,
    updatedAt: { gte: startOfToday },
  };
}

export function getTodayStartIso(timeZone?: string | null): string {
  return getStartOfDealershipDay(new Date(), resolveDealershipTimezone(timeZone)).toISOString();
}