/**
 * PR-M4 — loaner domain services for dashboard + future voice agent tools.
 * Always scope by dealershipId from auth/session — never trust model-supplied tenant.
 */

import type { PrismaClient } from '@prisma/client';
import { encryptSensitiveText } from '@/lib/encryption';
import { getRlsDb, type RlsDbClient } from '@/lib/apex/rlsContext';
import { last8OfVin, phoneLast4 } from '@/lib/department/piiHelpers';
import {
  LOANER_BLOCKED_FOR_RESERVE,
  type LoanerVehicleStatus,
} from '@/lib/loaner/constants';
import { mapLoanerAssignment, mapLoanerVehicle } from '@/lib/loaner/mappers';

type Db = RlsDbClient | PrismaClient;

function db(client?: Db): Db {
  return client ?? getRlsDb();
}

export type DamageMark = {
  area: string;
  note?: string;
  severity?: 'minor' | 'major';
};

export async function listLoanerVehicles(
  dealershipId: string,
  options?: { status?: LoanerVehicleStatus; db?: Db }
) {
  const rows = await db(options?.db).loanerVehicle.findMany({
    where: {
      dealershipId,
      ...(options?.status ? { status: options.status } : {}),
    },
    orderBy: [{ status: 'asc' }, { unitNumber: 'asc' }],
    take: 200,
  });
  return rows.map(mapLoanerVehicle);
}

/**
 * Agent-friendly: units that can be reserved right now.
 */
export async function listAvailableLoaners(
  dealershipId: string,
  options?: { db?: Db }
) {
  return listLoanerVehicles(dealershipId, { status: 'available', db: options?.db });
}

export async function createLoanerReservation(
  input: {
    dealershipId: string;
    dealerId?: string | null;
    loanerVehicleId: string;
    customerName?: string;
    customerPhone?: string;
    dueBackAt?: Date | null;
    repairOrderId?: string | null;
    departmentRequestId?: string | null;
    notes?: string;
    createdById?: string | null;
    /** reserved | active (checkout immediately) */
    mode?: 'reserve' | 'checkout';
    outOdometer?: number | null;
    fuelOut?: string | null;
    damageOut?: DamageMark[];
  },
  options?: { db?: Db }
) {
  const client = db(options?.db);
  const vehicle = await client.loanerVehicle.findFirst({
    where: { id: input.loanerVehicleId, dealershipId: input.dealershipId },
  });
  if (!vehicle) {
    throw new Error('LOANER_VEHICLE_NOT_FOUND');
  }
  if (LOANER_BLOCKED_FOR_RESERVE.has(vehicle.status as LoanerVehicleStatus)) {
    throw new Error('LOANER_VEHICLE_NOT_AVAILABLE');
  }

  const mode = input.mode || 'reserve';
  const phone = (input.customerPhone || '').trim();
  const now = new Date();

  const assignment = await client.loanerAssignment.create({
    data: {
      dealershipId: input.dealershipId,
      dealerId: input.dealerId ?? null,
      loanerVehicleId: vehicle.id,
      customerNameEncrypted: encryptSensitiveText((input.customerName || '').trim()),
      customerPhoneEncrypted: encryptSensitiveText(phone),
      customerPhoneLast4: phoneLast4(phone),
      repairOrderId: input.repairOrderId ?? null,
      departmentRequestId: input.departmentRequestId ?? null,
      dueBackAt: input.dueBackAt ?? null,
      checkoutAt: mode === 'checkout' ? now : null,
      outOdometer:
        mode === 'checkout'
          ? input.outOdometer ?? vehicle.odometer
          : input.outOdometer ?? null,
      fuelOut: mode === 'checkout' ? input.fuelOut ?? null : input.fuelOut ?? null,
      damageOutJson: JSON.stringify(input.damageOut || []),
      status: mode === 'checkout' ? 'active' : 'reserved',
      createdById: input.createdById ?? null,
      notesEncrypted: encryptSensitiveText((input.notes || '').trim()),
    },
    include: {
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
    },
  });

  await client.loanerVehicle.update({
    where: { id: vehicle.id },
    data: {
      status: mode === 'checkout' ? 'out' : 'reserved',
      ...(mode === 'checkout' && input.outOdometer != null
        ? { odometer: input.outOdometer }
        : {}),
    },
  });

  return mapLoanerAssignment(assignment);
}

export async function checkoutLoanerAssignment(
  input: {
    dealershipId: string;
    assignmentId: string;
    outOdometer?: number | null;
    fuelOut?: string | null;
    damageOut?: DamageMark[];
  },
  options?: { db?: Db }
) {
  const client = db(options?.db);
  const assignment = await client.loanerAssignment.findFirst({
    where: { id: input.assignmentId, dealershipId: input.dealershipId },
    include: { loanerVehicle: true },
  });
  if (!assignment) throw new Error('LOANER_ASSIGNMENT_NOT_FOUND');
  if (assignment.status !== 'reserved') throw new Error('LOANER_ASSIGNMENT_NOT_RESERVED');

  const outOdo = input.outOdometer ?? assignment.loanerVehicle.odometer;
  const updated = await client.loanerAssignment.update({
    where: { id: assignment.id },
    data: {
      status: 'active',
      checkoutAt: new Date(),
      outOdometer: outOdo,
      fuelOut: input.fuelOut ?? assignment.fuelOut,
      damageOutJson:
        input.damageOut != null
          ? JSON.stringify(input.damageOut)
          : assignment.damageOutJson,
    },
    include: {
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
    },
  });

  await client.loanerVehicle.update({
    where: { id: assignment.loanerVehicleId },
    data: { status: 'out', odometer: outOdo },
  });

  return mapLoanerAssignment(updated);
}

export async function returnLoanerAssignment(
  input: {
    dealershipId: string;
    assignmentId: string;
    inOdometer?: number | null;
    fuelIn?: string | null;
    damageIn?: DamageMark[];
    markVehicleStatus?: 'available' | 'maintenance' | 'out_of_service';
  },
  options?: { db?: Db }
) {
  const client = db(options?.db);
  const assignment = await client.loanerAssignment.findFirst({
    where: { id: input.assignmentId, dealershipId: input.dealershipId },
    include: { loanerVehicle: true },
  });
  if (!assignment) throw new Error('LOANER_ASSIGNMENT_NOT_FOUND');
  if (assignment.status !== 'active' && assignment.status !== 'reserved') {
    throw new Error('LOANER_ASSIGNMENT_NOT_OPEN');
  }

  const inOdo =
    input.inOdometer ??
    assignment.outOdometer ??
    assignment.loanerVehicle.odometer;
  const vehicleStatus = input.markVehicleStatus || 'available';

  const updated = await client.loanerAssignment.update({
    where: { id: assignment.id },
    data: {
      status: 'returned',
      returnedAt: new Date(),
      inOdometer: inOdo,
      fuelIn: input.fuelIn ?? null,
      damageInJson: JSON.stringify(input.damageIn || []),
      ...(assignment.status === 'reserved' && !assignment.checkoutAt
        ? { checkoutAt: new Date(), outOdometer: inOdo }
        : {}),
    },
    include: {
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
    },
  });

  await client.loanerVehicle.update({
    where: { id: assignment.loanerVehicleId },
    data: {
      status: vehicleStatus,
      odometer: inOdo,
    },
  });

  return mapLoanerAssignment(updated);
}

export { last8OfVin, phoneLast4 };
