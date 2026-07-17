import { decryptSensitiveText } from '@/lib/encryption';

export type LoanerVehicleRow = {
  id: string;
  dealershipId: string;
  unitNumber: string;
  vinEncrypted: string;
  vinLast8: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  plateEncrypted: string;
  color: string | null;
  odometer: number;
  status: string;
  notesEncrypted: string;
  createdAt: Date;
  updatedAt: Date;
  assignments?: LoanerAssignmentRow[];
};

export type LoanerAssignmentRow = {
  id: string;
  dealershipId: string;
  loanerVehicleId: string;
  customerNameEncrypted: string;
  customerPhoneEncrypted: string;
  customerPhoneLast4: string;
  repairOrderId: string | null;
  departmentRequestId: string | null;
  checkoutAt: Date | null;
  dueBackAt: Date | null;
  returnedAt: Date | null;
  outOdometer: number | null;
  inOdometer: number | null;
  fuelOut: string | null;
  fuelIn: string | null;
  damageOutJson: string;
  damageInJson: string;
  status: string;
  createdById: string | null;
  notesEncrypted: string;
  createdAt: Date;
  updatedAt: Date;
  loanerVehicle?: {
    id: string;
    unitNumber: string;
    year: number | null;
    make: string | null;
    model: string | null;
    status: string;
    color: string | null;
    odometer: number;
  } | null;
  createdBy?: { name: string } | null;
};

function parseDamageJson(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapLoanerVehicle(row: LoanerVehicleRow) {
  const vehicleLabel = [row.year, row.make, row.model].filter(Boolean).join(' ') || null;
  return {
    id: row.id,
    unitNumber: row.unitNumber,
    vin: decryptSensitiveText(row.vinEncrypted || ''),
    vinLast8: row.vinLast8,
    year: row.year,
    make: row.make,
    model: row.model,
    vehicleLabel,
    plate: decryptSensitiveText(row.plateEncrypted || ''),
    color: row.color,
    odometer: row.odometer,
    status: row.status,
    notes: decryptSensitiveText(row.notesEncrypted || ''),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapLoanerAssignment(row: LoanerAssignmentRow) {
  return {
    id: row.id,
    loanerVehicleId: row.loanerVehicleId,
    unitNumber: row.loanerVehicle?.unitNumber ?? null,
    vehicleLabel: row.loanerVehicle
      ? [row.loanerVehicle.year, row.loanerVehicle.make, row.loanerVehicle.model]
          .filter(Boolean)
          .join(' ') || null
      : null,
    vehicleStatus: row.loanerVehicle?.status ?? null,
    customerName: decryptSensitiveText(row.customerNameEncrypted || ''),
    customerPhone: decryptSensitiveText(row.customerPhoneEncrypted || ''),
    customerPhoneLast4: row.customerPhoneLast4 || null,
    repairOrderId: row.repairOrderId,
    departmentRequestId: row.departmentRequestId,
    checkoutAt: row.checkoutAt ? row.checkoutAt.toISOString() : null,
    dueBackAt: row.dueBackAt ? row.dueBackAt.toISOString() : null,
    returnedAt: row.returnedAt ? row.returnedAt.toISOString() : null,
    outOdometer: row.outOdometer,
    inOdometer: row.inOdometer,
    fuelOut: row.fuelOut,
    fuelIn: row.fuelIn,
    damageOut: parseDamageJson(row.damageOutJson),
    damageIn: parseDamageJson(row.damageInJson),
    status: row.status,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? null,
    notes: decryptSensitiveText(row.notesEncrypted || ''),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
