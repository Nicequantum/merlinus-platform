export const HUB_APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type HubAppointmentStatus = (typeof HUB_APPOINTMENT_STATUSES)[number];

export const HUB_APPOINTMENT_CATEGORIES = [
  'service',
  'sales',
  'parts',
  'loaner',
  'other',
] as const;
export type HubAppointmentCategory = (typeof HUB_APPOINTMENT_CATEGORIES)[number];

export const HUB_INSIGHT_PROMPT_VERSION = 'hub-insight-v1';

export const HUB_STATUS_LABELS: Record<HubAppointmentStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export const HUB_CATEGORY_LABELS: Record<HubAppointmentCategory, string> = {
  service: 'Service',
  sales: 'Sales',
  parts: 'Parts',
  loaner: 'Loaner',
  other: 'Other',
};
