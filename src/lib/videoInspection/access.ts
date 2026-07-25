import type { SessionPayload } from '@/lib/auth';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { requireDealershipScope } from '@/lib/apex/tenantScope';
import { effectiveIsAdmin, effectiveRole } from '@/lib/apex/viewAs';
import { readEncryptedPiiTolerant } from '@/lib/piiFieldRead';

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

/** Prefill fields copied from a same-rooftop RepairOrder into Video MPI. */
export type RepairOrderLinkResult = {
  repairOrderId: string | null;
  repairLineId: string | null;
  /** year make model from RO */
  vehicleLabel: string | null;
  customerName: string | null;
  /**
   * RepairOrder has no customer phone column today — always null from RO.
   * Kept for a stable MPI contract when phone is added later.
   */
  customerPhone: string | null;
  vin: string | null;
};

const EMPTY_LINK: RepairOrderLinkResult = {
  repairOrderId: null,
  repairLineId: null,
  vehicleLabel: null,
  customerName: null,
  customerPhone: null,
  vin: null,
};

function buildVehicleLabel(year?: string | null, make?: string | null, model?: string | null): string | null {
  const label = [year, make, model]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(' ');
  return label || null;
}

/**
 * Ensure optional repairOrderId belongs to the same rooftop before linking.
 * Loads VIN / customer name / vehicle label for MPI prefill (tenant-scoped).
 * Returns nulls when empty/unset.
 */
export async function resolveRepairOrderLink(
  session: SessionPayload,
  repairOrderId: string | null | undefined,
  repairLineId?: string | null
): Promise<RepairOrderLinkResult> {
  const roId = repairOrderId?.trim() || '';
  if (!roId) {
    return { ...EMPTY_LINK };
  }
  const dealershipId = resolveVideoDealershipId(session);
  const db = getRlsDb();
  const ro = await db.repairOrder.findFirst({
    where: { id: roId, dealershipId },
    select: {
      id: true,
      year: true,
      make: true,
      model: true,
      vinEncrypted: true,
      customerNameEncrypted: true,
    },
  });
  if (!ro) {
    throw new Error('Repair order not found for this dealership');
  }

  const vin = readEncryptedPiiTolerant({ encrypted: ro.vinEncrypted }).value?.trim() || null;
  const customerName =
    readEncryptedPiiTolerant({ encrypted: ro.customerNameEncrypted }).value?.trim() || null;

  const lineId = repairLineId?.trim() || '';
  let resolvedLineId: string | null = null;
  if (lineId) {
    const line = await db.repairLine.findFirst({
      where: { id: lineId, repairOrderId: ro.id },
      select: { id: true },
    });
    resolvedLineId = line?.id ?? null;
  }

  return {
    repairOrderId: ro.id,
    repairLineId: resolvedLineId,
    vehicleLabel: buildVehicleLabel(ro.year, ro.make, ro.model),
    customerName,
    customerPhone: null,
    vin: vin ? vin.toUpperCase() : null,
  };
}

/**
 * Merge client-provided MPI fields with RO prefill — client wins when non-empty.
 */
export function mergeVideoFieldsWithRoPrefill(
  client: {
    vehicleLabel?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    vin?: string | null;
  },
  link: RepairOrderLinkResult
): {
  vehicleLabel: string | null;
  customerName: string;
  customerPhone: string;
  vin: string;
} {
  const vehicleLabel =
    (client.vehicleLabel || '').trim() || link.vehicleLabel || null;
  const customerName = (client.customerName || '').trim() || link.customerName || '';
  const customerPhone = (client.customerPhone || '').trim() || link.customerPhone || '';
  const vin = ((client.vin || '').trim() || link.vin || '').toUpperCase();
  return { vehicleLabel, customerName, customerPhone, vin };
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
