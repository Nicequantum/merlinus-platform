import type { RepairLineSoldMetrics } from '@/types';

type SoldMetricsRow = {
  soldLaborHours: number | null;
  soldLaborAmount: number | null;
  soldPartsAmount: number | null;
  customerApproved: boolean | null;
  isAddOn: boolean | null;
  soldMetricsUpdatedAt: Date | null;
};

export function mapSoldMetricsFromDb(line: SoldMetricsRow): RepairLineSoldMetrics {
  return {
    soldLaborHours: line.soldLaborHours,
    soldLaborAmount: line.soldLaborAmount,
    soldPartsAmount: line.soldPartsAmount,
    customerApproved: line.customerApproved,
    isAddOn: line.isAddOn,
    soldMetricsUpdatedAt: line.soldMetricsUpdatedAt?.toISOString() ?? null,
  };
}

export function lineSoldTotal(line: {
  soldLaborAmount: number | null;
  soldPartsAmount: number | null;
}): number {
  return (line.soldLaborAmount ?? 0) + (line.soldPartsAmount ?? 0);
}

export function hasSoldMetrics(line: RepairLineSoldMetrics | null | undefined): boolean {
  if (!line) return false;
  return (
    line.soldLaborHours != null ||
    line.soldLaborAmount != null ||
    line.soldPartsAmount != null ||
    line.customerApproved != null ||
    line.isAddOn != null
  );
}

export function soldMetricsToDbUpdateFields(
  metrics: Partial<RepairLineSoldMetrics>
): {
  soldLaborHours?: number | null;
  soldLaborAmount?: number | null;
  soldPartsAmount?: number | null;
  customerApproved?: boolean | null;
  isAddOn?: boolean | null;
  soldMetricsUpdatedAt: Date;
} {
  const data: {
    soldLaborHours?: number | null;
    soldLaborAmount?: number | null;
    soldPartsAmount?: number | null;
    customerApproved?: boolean | null;
    isAddOn?: boolean | null;
    soldMetricsUpdatedAt: Date;
  } = {
    soldMetricsUpdatedAt: new Date(),
  };

  if (metrics.soldLaborHours !== undefined) data.soldLaborHours = metrics.soldLaborHours;
  if (metrics.soldLaborAmount !== undefined) data.soldLaborAmount = metrics.soldLaborAmount;
  if (metrics.soldPartsAmount !== undefined) data.soldPartsAmount = metrics.soldPartsAmount;
  if (metrics.customerApproved !== undefined) data.customerApproved = metrics.customerApproved;
  if (metrics.isAddOn !== undefined) data.isAddOn = metrics.isAddOn;

  return data;
}