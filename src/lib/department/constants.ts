/**
 * Shared department inbox constants (Parts / Sales / Service).
 * Independent of warranty RO story pipeline.
 */

import type { ProductModuleId } from '@/lib/modules/catalog';

export const DEPARTMENT_IDS = [
  'sales',
  'service',
  'parts',
  'loaner',
  'maintenance',
] as const;

export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

/** Departments that use the unified DepartmentRequest inbox shell (PR-M8). */
export const INBOX_DEPARTMENT_IDS = ['parts', 'sales', 'service'] as const;
export type InboxDepartmentId = (typeof INBOX_DEPARTMENT_IDS)[number];

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

export function isInboxDepartmentId(value: string): value is InboxDepartmentId {
  return (INBOX_DEPARTMENT_IDS as readonly string[]).includes(value);
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

/** Map inbox department → product module entitlement id. */
export function moduleForDepartment(department: DepartmentId): ProductModuleId | null {
  if (department === 'parts') return 'parts';
  if (department === 'sales') return 'sales';
  if (department === 'service') return 'service';
  return null;
}

/** Roles that may use department inboxes for a given department. */
export function canAccessDepartmentInbox(role: string, department: DepartmentId): boolean {
  if (role === 'manager' || role === 'owner') return true;
  if (department === 'parts' && role === 'parts') return true;
  if (department === 'sales' && role === 'sales') return true;
  if (department === 'service' && role === 'service') return true;
  // Facility tickets use MaintenanceTicket (PR-M3), not this inbox.
  return false;
}

export const INBOX_EMPTY_COPY: Record<InboxDepartmentId, string> = {
  parts: 'No parts requests yet — create one from a phone call or walk-in.',
  sales: 'No sales leads yet — create one from a call, walk-in, or voice agent.',
  service: 'No service requests yet — create one from a call or voice agent follow-up.',
};

export const INBOX_MODULE_HINT: Record<InboxDepartmentId, string> = {
  parts: 'Parts Department',
  sales: 'Sales Department',
  service: 'Service Department',
};
