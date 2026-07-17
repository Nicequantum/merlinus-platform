import type { SessionPayload } from '@/lib/auth';
import { effectiveRole } from '@/lib/apex/viewAs';
import { getRlsDb } from '@/lib/apex/rlsContext';
import {
  canManageMaintenance,
  canSubmitMaintenance,
} from '@/lib/maintenance/constants';

export function assertCanSubmitMaintenance(session: SessionPayload): {
  ok: true;
} | { ok: false; message: string } {
  const role = effectiveRole(session);
  if (!canSubmitMaintenance(role)) {
    return { ok: false, message: `Role "${role}" cannot submit maintenance tickets` };
  }
  return { ok: true };
}

export function assertCanManageMaintenance(session: SessionPayload): {
  ok: true;
} | { ok: false; message: string } {
  const role = effectiveRole(session);
  if (!canManageMaintenance(role)) {
    return { ok: false, message: `Role "${role}" cannot manage maintenance tickets` };
  }
  return { ok: true };
}

export const maintenanceTicketInclude = {
  createdBy: { select: { name: true } },
  assignedTo: { select: { name: true } },
  photos: { orderBy: { createdAt: 'asc' as const } },
  events: {
    orderBy: { createdAt: 'desc' as const },
    take: 40,
    include: { actor: { select: { name: true } } },
  },
};

export async function findMaintenanceTicketForSession(session: SessionPayload, id: string) {
  return getRlsDb().maintenanceTicket.findFirst({
    where: {
      id: id.trim(),
      dealershipId: session.dealershipId,
    },
    include: maintenanceTicketInclude,
  });
}
