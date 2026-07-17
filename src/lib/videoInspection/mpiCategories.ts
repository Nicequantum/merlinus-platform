/**
 * PR-M1a — multipoint inspection categories & severities.
 * Independent of warranty story pipeline.
 */

export const MPI_SEVERITIES = ['ok', 'recommend', 'urgent'] as const;
export type MpiSeverity = (typeof MPI_SEVERITIES)[number];

export const MPI_CATEGORIES = [
  'tires_wheels',
  'brakes',
  'battery_charging',
  'fluids_leaks',
  'belts_hoses',
  'lights_electrical',
  'wipers_visibility',
  'suspension_steering',
  'exhaust',
  'cabin_interior',
  'exterior_body',
  'other',
] as const;

export type MpiCategory = (typeof MPI_CATEGORIES)[number];

export const MPI_CATEGORY_LABELS: Record<MpiCategory, string> = {
  tires_wheels: 'Tires & wheels',
  brakes: 'Brakes',
  battery_charging: 'Battery & charging',
  fluids_leaks: 'Fluids & leaks',
  belts_hoses: 'Belts & hoses',
  lights_electrical: 'Lights & electrical',
  wipers_visibility: 'Wipers & visibility',
  suspension_steering: 'Suspension & steering',
  exhaust: 'Exhaust',
  cabin_interior: 'Cabin & interior',
  exterior_body: 'Exterior & body',
  other: 'Other',
};

export const MPI_SEVERITY_LABELS: Record<MpiSeverity, string> = {
  ok: 'OK',
  recommend: 'Recommend',
  urgent: 'Urgent',
};

export const MPI_STATUSES = ['draft', 'processing', 'ready', 'failed', 'sent'] as const;
export type MpiStatus = (typeof MPI_STATUSES)[number];

export function isMpiSeverity(value: string): value is MpiSeverity {
  return (MPI_SEVERITIES as readonly string[]).includes(value);
}

export function isMpiCategory(value: string): value is MpiCategory {
  return (MPI_CATEGORIES as readonly string[]).includes(value);
}

export function isMpiStatus(value: string): value is MpiStatus {
  return (MPI_STATUSES as readonly string[]).includes(value);
}

export function mpiCategoryLabel(category: string): string {
  if (isMpiCategory(category)) return MPI_CATEGORY_LABELS[category];
  return category.replace(/_/g, ' ');
}

/** Compact denormalized summary: ok:n|recommend:n|urgent:n */
export function computeSeveritySummary(
  findings: ReadonlyArray<{ severity: string }>
): string {
  const counts: Record<MpiSeverity, number> = { ok: 0, recommend: 0, urgent: 0 };
  for (const f of findings) {
    if (isMpiSeverity(f.severity)) counts[f.severity] += 1;
  }
  return `ok:${counts.ok}|recommend:${counts.recommend}|urgent:${counts.urgent}`;
}

export function parseSeveritySummary(summary: string | null | undefined): Record<MpiSeverity, number> {
  const counts: Record<MpiSeverity, number> = { ok: 0, recommend: 0, urgent: 0 };
  if (!summary?.trim()) return counts;
  for (const part of summary.split('|')) {
    const [key, raw] = part.split(':');
    if (key && isMpiSeverity(key)) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) counts[key] = Math.floor(n);
    }
  }
  return counts;
}

export function last8OfVin(vin: string): string | null {
  const cleaned = vin.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleaned.length < 8) return cleaned || null;
  return cleaned.slice(-8);
}

export function phoneLast4(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return digits;
  return digits.slice(-4);
}
