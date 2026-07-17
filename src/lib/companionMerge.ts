import type { RepairLine, RepairOrder } from '@/types';

export function applyCompanionROPatch(
  ro: RepairOrder,
  payload: {
    repairOrderId: string;
    lineId?: string;
    linePatch?: Partial<RepairLine>;
    roPatch?: Partial<Pick<RepairOrder, 'roNumber' | 'complaints' | 'vehicle' | 'customer'>>;
  }
): RepairOrder | null {
  if (ro.id !== payload.repairOrderId) return null;

  let next: RepairOrder = ro;
  if (payload.roPatch) {
    next = {
      ...next,
      ...payload.roPatch,
      vehicle: payload.roPatch.vehicle ? { ...next.vehicle, ...payload.roPatch.vehicle } : next.vehicle,
      customer: payload.roPatch.customer ? { ...next.customer, ...payload.roPatch.customer } : next.customer,
    };
  }

  if (payload.lineId && payload.linePatch) {
    next = {
      ...next,
      repairLines: next.repairLines.map((line) =>
        line.id === payload.lineId ? { ...line, ...payload.linePatch } : line
      ),
    };
  }

  return next;
}