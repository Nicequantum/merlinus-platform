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
    const term = params.q;
    const roSearchTokens = buildRoNumberSearchQueryTokens(term);
    const orClauses: Prisma.RepairOrderWhereInput[] = [
      { year: { contains: term, mode: 'insensitive' } },
      { make: { contains: term, mode: 'insensitive' } },
      { model: { contains: term, mode: 'insensitive' } },
    ];

    if (roSearchTokens.length > 0) {
      orClauses.unshift({ roNumberSearchTokens: { hasSome: roSearchTokens } });
    }

    return {
      ...roleWhere,
      OR: orClauses,
    };
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