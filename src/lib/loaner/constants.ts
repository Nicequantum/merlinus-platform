/**
 * PR-M4 — loaner fleet constants (independent of RO story / Parts / Maintenance).
 */

export const LOANER_VEHICLE_STATUSES = [
  'available',
  'reserved',
  'out',
  'maintenance',
  'out_of_service',
] as const;
export type LoanerVehicleStatus = (typeof LOANER_VEHICLE_STATUSES)[number];

export const LOANER_ASSIGNMENT_STATUSES = [
  'reserved',
  'active',
  'returned',
  'cancelled',
] as const;
export type LoanerAssignmentStatus = (typeof LOANER_ASSIGNMENT_STATUSES)[number];

export const LOANER_VEHICLE_STATUS_LABELS: Record<LoanerVehicleStatus, string> = {
  available: 'Available',
  reserved: 'Reserved',
  out: 'Out',
  maintenance: 'In shop',
  out_of_service: 'Out of service',
};

export const LOANER_ASSIGNMENT_STATUS_LABELS: Record<LoanerAssignmentStatus, string> = {
  reserved: 'Reserved',
  active: 'Checked out',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export const FUEL_LEVELS = ['E', '1/4', '1/2', '3/4', 'F'] as const;

export function isLoanerVehicleStatus(value: string): value is LoanerVehicleStatus {
  return (LOANER_VEHICLE_STATUSES as readonly string[]).includes(value);
}

export function isLoanerAssignmentStatus(value: string): value is LoanerAssignmentStatus {
  return (LOANER_ASSIGNMENT_STATUSES as readonly string[]).includes(value);
}

/** Desk staff + managers operate the fleet; managers/owners always allowed. */
export function canAccessLoanerModule(role: string): boolean {
  return (
    role === 'loaner' ||
    role === 'manager' ||
    role === 'owner' ||
    role === 'service_advisor' // advisors often book loaners at write-up
  );
}

/** Mutating fleet inventory (add/edit units) — loaner desk + managers. */
export function canManageLoanerFleet(role: string): boolean {
  return role === 'loaner' || role === 'manager' || role === 'owner';
}

/** Statuses that block new reservations. */
export const LOANER_BLOCKED_FOR_RESERVE: ReadonlySet<LoanerVehicleStatus> = new Set([
  'out',
  'reserved',
  'maintenance',
  'out_of_service',
]);
