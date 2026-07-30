/**
 * Client-side bridge so repair-order edits can publish live companion patches
 * without prop-drilling through every hook.
 */
import type { RepairLine, RepairOrder } from '@/types';

type LivePublisher = {
  publishROPatch: (payload: {
    repairOrderId: string;
    lineId?: string;
    linePatch?: Partial<RepairLine>;
    roPatch?: Partial<Pick<RepairOrder, 'roNumber' | 'complaints' | 'vehicle' | 'customer'>>;
  }) => void;
  publishActivity?: (
    label: string,
    options?: { detail?: string; repairOrderId?: string | null; lineId?: string | null }
  ) => void;
};

let publisher: LivePublisher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pending: {
  repairOrderId: string;
  lineId?: string;
  linePatch?: Partial<RepairLine>;
  roPatch?: Partial<Pick<RepairOrder, 'roNumber' | 'complaints' | 'vehicle' | 'customer'>>;
} | null = null;

export function setCompanionLivePublisher(next: LivePublisher | null): void {
  publisher = next;
}

export function getCompanionLivePublisher(): LivePublisher | null {
  return publisher;
}

/** Debounced live mirror of in-progress typing (before or after save). */
export function publishCompanionLivePatch(
  payload: {
    repairOrderId: string;
    lineId?: string;
    linePatch?: Partial<RepairLine>;
    roPatch?: Partial<Pick<RepairOrder, 'roNumber' | 'complaints' | 'vehicle' | 'customer'>>;
  },
  options?: { immediate?: boolean }
): void {
  if (!publisher) return;

  if (options?.immediate) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pending = null;
    publisher.publishROPatch(payload);
    return;
  }

  // Merge pending patches for same RO/line
  if (
    pending &&
    pending.repairOrderId === payload.repairOrderId &&
    pending.lineId === payload.lineId
  ) {
    pending = {
      repairOrderId: payload.repairOrderId,
      lineId: payload.lineId,
      linePatch: { ...pending.linePatch, ...payload.linePatch },
      roPatch: { ...pending.roPatch, ...payload.roPatch },
    };
  } else {
    pending = { ...payload };
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const toSend = pending;
    pending = null;
    debounceTimer = null;
    if (toSend && publisher) publisher.publishROPatch(toSend);
  }, 350);
}
