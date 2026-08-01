import 'server-only';

import {
  listDealerIdsForOwnerGroups,
  listEnterableDealershipsForOwner,
} from '@/lib/apex/dealerGroupAccess';
import { isPlatformOperator } from '@/lib/apex/platformOperator';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import type { PilotExportActor } from '@/lib/pilotExport/types';

export interface PilotExportScope {
  /** null = unrestricted platform operator / service token sees all non-sentinel rooftops */
  dealershipIds: string[];
  dealerIds: string[] | null;
  unrestricted: boolean;
}

/**
 * Resolve which rooftops the actor may export.
 * - Service token: all real dealerships (migration partner sees full pilot staging)
 * - Platform operator owner: all real dealerships
 * - Group owner: enterable rooftops only
 */
export async function resolvePilotExportScope(
  actor: PilotExportActor,
  filterDealershipId?: string | null
): Promise<PilotExportScope> {
  return withRlsBypass(async () => {
    let dealershipIds: string[] = [];
    let dealerIds: string[] | null = null;
    let unrestricted = false;

    if (actor.mode === 'service_token') {
      unrestricted = true;
      const rows = await getRlsDb().dealership.findMany({
        where: { id: { not: APEX_NATIONAL_DEALERSHIP_ID } },
        select: { id: true, dealerId: true },
        orderBy: { name: 'asc' },
      });
      dealershipIds = rows.map((r) => r.id);
      dealerIds = [
        ...new Set(rows.map((r) => r.dealerId).filter((x): x is string => Boolean(x))),
      ];
    } else if (actor.technicianId) {
      if (await isPlatformOperator(actor.technicianId)) {
        unrestricted = true;
        const rows = await getRlsDb().dealership.findMany({
          where: { id: { not: APEX_NATIONAL_DEALERSHIP_ID } },
          select: { id: true, dealerId: true },
          orderBy: { name: 'asc' },
        });
        dealershipIds = rows.map((r) => r.id);
        dealerIds = [
          ...new Set(rows.map((r) => r.dealerId).filter((x): x is string => Boolean(x))),
        ];
      } else {
        const enterable = await listEnterableDealershipsForOwner(actor.technicianId);
        dealershipIds = enterable.map((d) => d.id);
        dealerIds = await listDealerIdsForOwnerGroups(actor.technicianId);
      }
    }

    const filter = filterDealershipId?.trim();
    if (filter) {
      if (!dealershipIds.includes(filter)) {
        return { dealershipIds: [], dealerIds: [], unrestricted: false };
      }
      dealershipIds = [filter];
    }

    return { dealershipIds, dealerIds, unrestricted };
  });
}
