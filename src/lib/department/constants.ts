/**
 * PR-M2 — shared department inbox constants.
 * Independent of warranty RO story pipeline.
 */

export const DEPARTMENT_IDS = [
  'sales',
  'service',
  'parts',
  'loaner',
  'maintenance',
] as const;

export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

export const DEPARTMENT_LABELS: Record<DepartmentId, string> = {
  sales: 'Sales',
  service: 'Service',
  parts: 'Parts',
  loaner: 'Loaner',
  maintenance: 'Maintenance',
};

export const DEPARTMENT_REQUEST_STATUSES = [
  'new',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
] as const;

export type DepartmentRequestStatus = (typeof DEPARTMENT_REQUEST_STATUSES)[number];

export const DEPARTMENT_REQUEST_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type DepartmentRequestPriority = (typeof DEPARTMENT_REQUEST_PRIORITIES)[number];

export const DEPARTMENT_REQUEST_SOURCES = ['manual', 'voice_agent', 'cdk', 'web'] as const;
export type DepartmentRequestSource = (typeof DEPARTMENT_REQUEST_SOURCES)[number];

export const PARTS_LINE_STATUSES = [
  'requested',
  'quoted',
  'ordered',
  'eta',
  'ready',
  'closed',
] as const;
export type PartsLineStatus = (typeof PARTS_LINE_STATUSES)[number];

export function isDepartmentId(value: string): value is DepartmentId {
  return (DEPARTMENT_IDS as readonly string[]).includes(value);
}

export function isDepartmentRequestStatus(value: string): value is DepartmentRequestStatus {
  return (DEPARTMENT_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isDepartmentRequestPriority(value: string): value is DepartmentRequestPriority {
  return (DEPARTMENT_REQUEST_PRIORITIES as readonly string[]).includes(value);
}

export function isPartsLineStatus(value: string): value is PartsLineStatus {
  return (PARTS_LINE_STATUSES as readonly string[]).includes(value);
}

/** Roles that may use department inboxes for a given department module. */
export function canAccessDepartmentInbox(role: string, department: DepartmentId): boolean {
  if (role === 'manager' || role === 'owner') return true;
  if (department === 'parts' && role === 'parts') return true;
  // Future: sales, loaner, maintenance roles
  return false;
}
