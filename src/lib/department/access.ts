import type { SessionPayload } from '@/lib/auth';
import { effectiveRole } from '@/lib/apex/viewAs';
import { getRlsDb } from '@/lib/apex/rlsContext';
import {
  canAccessDepartmentInbox,
  type DepartmentId,
} from '@/lib/department/constants';

export function assertDepartmentInboxAccess(
  session: SessionPayload,
  department: DepartmentId
): { ok: true } | { ok: false; message: string } {
  const role = effectiveRole(session);
  if (!canAccessDepartmentInbox(role, department)) {
    return {
      ok: false,
      message: `Role "${role}" cannot access the ${department} inbox`,
    };
  }
  return { ok: true };
}

export const departmentRequestInclude = {
  createdBy: { select: { name: true } },
  assignedTo: { select: { name: true } },
  partsLines: { orderBy: { sortOrder: 'asc' as const } },
  partsLookups: {
    orderBy: { createdAt: 'desc' as const },
    take: 50,
    include: { createdBy: { select: { name: true } } },
  },
};

export async function findDepartmentRequestForSession(
  session: SessionPayload,
  id: string,
  department?: DepartmentId
) {
  return getRlsDb().departmentRequest.findFirst({
    where: {
      id: id.trim(),
      dealershipId: session.dealershipId,
      ...(department ? { department } : {}),
    },
    include: departmentRequestInclude,
  });
}
