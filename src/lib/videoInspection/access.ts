import type { SessionPayload } from '@/lib/auth';
import { getRlsDb } from '@/lib/apex/rlsContext';
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

export async function findInspectionForSession(session: SessionPayload, id: string) {
  const db = getRlsDb();
  const row = await db.videoInspection.findFirst({
    where: {
      id: id.trim(),
      dealershipId: session.dealershipId,
      ...(canListAllInspections(session) ? {} : { technicianId: session.technicianId }),
    },
    include: inspectionInclude,
  });
  return row;
}

export { inspectionInclude };
