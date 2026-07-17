import type { SessionPayload } from '@/lib/auth';
import { effectiveRole } from '@/lib/apex/viewAs';
import { getRlsDb } from '@/lib/apex/rlsContext';
import {
  canAccessLoanerModule,
  canManageLoanerFleet,
} from '@/lib/loaner/constants';

export function assertLoanerAccess(session: SessionPayload): {
  ok: true;
} | { ok: false; message: string } {
  const role = effectiveRole(session);
  if (!canAccessLoanerModule(role)) {
    return { ok: false, message: `Role "${role}" cannot access loaner fleet` };
  }
  return { ok: true };
}

export function assertLoanerFleetManage(session: SessionPayload): {
  ok: true;
} | { ok: false; message: string } {
  const role = effectiveRole(session);
  if (!canManageLoanerFleet(role)) {
    return { ok: false, message: `Role "${role}" cannot manage loaner inventory` };
  }
  return { ok: true };
}

export const loanerAssignmentInclude = {
  loanerVehicle: {
    select: {
      id: true,
      unitNumber: true,
      year: true,
      make: true,
      model: true,
      status: true,
      color: true,
      odometer: true,
    },
  },
  createdBy: { select: { name: true } },
};

export async function findLoanerVehicleForSession(session: SessionPayload, id: string) {
  return getRlsDb().loanerVehicle.findFirst({
    where: { id: id.trim(), dealershipId: session.dealershipId },
  });
}

export async function findLoanerAssignmentForSession(session: SessionPayload, id: string) {
  return getRlsDb().loanerAssignment.findFirst({
    where: { id: id.trim(), dealershipId: session.dealershipId },
    include: loanerAssignmentInclude,
  });
}
