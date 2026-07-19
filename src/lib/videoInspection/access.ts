import type { SessionPayload } from '@/lib/auth';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { requireDealershipScope } from '@/lib/apex/tenantScope';
import { effectiveIsAdmin, effectiveRole } from '@/lib/apex/viewAs';

/**
 * Managers / owners / GM lens see all rooftop inspections.
 * View As technician/advisor must not inherit seed isAdmin for list-all.
 */
export function canListAllInspections(session: SessionPayload): boolean {
  const role = effectiveRole(session);
  if (role === 'manager' || role === 'owner') return true;
  return effectiveIsAdmin(session);
}

const inspectionInclude = {
  technician: { select: { name: true } },
  dealership: { select: { name: true } },
  findings: { orderBy: { sortOrder: 'asc' as const } },
};

/** Active rooftop for video MPI (handles owner enter-dealership). */
export function resolveVideoDealershipId(session: SessionPayload): string {
  return requireDealershipScope(session).dealershipId;
}

/**
 * Ensure optional repairOrderId belongs to the same rooftop before linking.
 * Returns null when empty/unset.
 */
export async function resolveRepairOrderLink(
  session: SessionPayload,
  repairOrderId: string | null | undefined,
  repairLineId?: string | null
): Promise<{ repairOrderId: string | null; repairLineId: string | null }> {
  const roId = repairOrderId?.trim() || '';
  if (!roId) {
    return { repairOrderId: null, repairLineId: null };
  }
  const dealershipId = resolveVideoDealershipId(session);
  const db = getRlsDb();
  const ro = await db.repairOrder.findFirst({
    where: { id: roId, dealershipId },
    select: { id: true },
  });
  if (!ro) {
    throw new Error('Repair order not found for this dealership');
  }
  const lineId = repairLineId?.trim() || '';
  if (!lineId) {
    return { repairOrderId: ro.id, repairLineId: null };
  }
  const line = await db.repairLine.findFirst({
    where: { id: lineId, repairOrderId: ro.id },
    select: { id: true },
  });
  return { repairOrderId: ro.id, repairLineId: line?.id ?? null };
}

export async function findInspectionForSession(session: SessionPayload, id: string) {
  const db = getRlsDb();
  const dealershipId = resolveVideoDealershipId(session);
  const row = await db.videoInspection.findFirst({
    where: {
      id: id.trim(),
      dealershipId,
      ...(canListAllInspections(session) ? {} : { technicianId: session.technicianId }),
    },
    include: inspectionInclude,
  });
  return row;
}

export { inspectionInclude };
