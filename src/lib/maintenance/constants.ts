/**
 * PR-M3 — maintenance ticket constants (independent of department voice inbox).
 */

export const MAINTENANCE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type MaintenanceSeverity = (typeof MAINTENANCE_SEVERITIES)[number];

export const MAINTENANCE_STATUSES = [
  'submitted',
  'triage',
  'scheduled',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;
export type MaintenanceTicketStatus = (typeof MAINTENANCE_STATUSES)[number];

/** Kanban columns (active work); done/cancelled shown in a closed board. */
export const MAINTENANCE_KANBAN_COLUMNS: MaintenanceTicketStatus[] = [
  'submitted',
  'triage',
  'scheduled',
  'in_progress',
  'blocked',
];

export const MAINTENANCE_DEPARTMENTS = [
  'facilities',
  'service',
  'sales',
  'parts',
  'all',
] as const;
export type MaintenanceDepartment = (typeof MAINTENANCE_DEPARTMENTS)[number];

export const MAINTENANCE_SEVERITY_LABELS: Record<MaintenanceSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceTicketStatus, string> = {
  submitted: 'Submitted',
  triage: 'Triage',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function isMaintenanceSeverity(value: string): value is MaintenanceSeverity {
  return (MAINTENANCE_SEVERITIES as readonly string[]).includes(value);
}

export function isMaintenanceStatus(value: string): value is MaintenanceTicketStatus {
  return (MAINTENANCE_STATUSES as readonly string[]).includes(value);
}

export function isMaintenanceDepartment(value: string): value is MaintenanceDepartment {
  return (MAINTENANCE_DEPARTMENTS as readonly string[]).includes(value);
}

/** Any rooftop staff may submit tickets when the module is on. */
export function canSubmitMaintenance(role: string): boolean {
  return (
    role === 'technician' ||
    role === 'manager' ||
    role === 'service_advisor' ||
    role === 'parts' ||
    role === 'maintenance' ||
    role === 'owner'
  );
}

/** Facilities team + managers: assign, status, full kanban ops. */
export function canManageMaintenance(role: string): boolean {
  return role === 'maintenance' || role === 'manager' || role === 'owner';
}
