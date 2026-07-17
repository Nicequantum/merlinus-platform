import type { RepairOrder, RepairOrderSummary } from '@/types';

/** Derive a list summary from a fully hydrated repair order (e.g. after create/save). */
export function repairOrderToSummary(ro: RepairOrder): RepairOrderSummary {
  const firstComplaintPreview = ro.complaints[0]?.trim() || undefined;

  return {
    id: ro.id,
    roNumber: ro.roNumber,
    vehicle: {
      year: ro.vehicle.year,
      make: ro.vehicle.make,
      model: ro.vehicle.model,
    },
    firstComplaintPreview,
    repairLines: ro.repairLines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      isCustomerPay: line.isCustomerPay ?? false,
      hasWarrantyStory: Boolean(line.warrantyStory?.trim()),
      soldMetrics: line.soldMetrics,
    })),
    createdAt: ro.createdAt,
    updatedAt: ro.updatedAt,
    technicianId: ro.technicianId,
    technicianName: ro.technicianName,
  };
}