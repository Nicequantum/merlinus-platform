/**
 * Client-side RO list cache — stale-while-revalidate for bay first paint.
 * Survives soft navigations within the same tablet session (sessionStorage).
 */
import type { RepairOrderSummary } from '@/types';

const CACHE_PREFIX = 'merlinus.roList.v1:';
const MAX_AGE_MS = 5 * 60_000;
const STALE_OK_MS = 30 * 60_000;

export interface RoListCachePayload {
  technicianId: string;
  dealershipId: string;
  repairOrders: RepairOrderSummary[];
  todayStart?: string | null;
  cachedAt: number;
}

function cacheKey(technicianId: string, dealershipId: string): string {
  return `${CACHE_PREFIX}${dealershipId}:${technicianId}`;
}

export function readRoListCache(
  technicianId: string,
  dealershipId: string
): { payload: RoListCachePayload; fresh: boolean; stale: boolean } | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(technicianId, dealershipId));
    if (!raw) return null;
    const payload = JSON.parse(raw) as RoListCachePayload;
    if (
      !payload ||
      payload.technicianId !== technicianId ||
      payload.dealershipId !== dealershipId ||
      !Array.isArray(payload.repairOrders)
    ) {
      return null;
    }
    const age = Date.now() - (payload.cachedAt || 0);
    if (age > STALE_OK_MS) return null;
    return {
      payload,
      fresh: age <= MAX_AGE_MS,
      stale: age > MAX_AGE_MS,
    };
  } catch {
    return null;
  }
}

export function writeRoListCache(input: {
  technicianId: string;
  dealershipId: string;
  repairOrders: RepairOrderSummary[];
  todayStart?: string | null;
}): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const payload: RoListCachePayload = {
      technicianId: input.technicianId,
      dealershipId: input.dealershipId,
      repairOrders: input.repairOrders,
      todayStart: input.todayStart ?? null,
      cachedAt: Date.now(),
    };
    sessionStorage.setItem(
      cacheKey(input.technicianId, input.dealershipId),
      JSON.stringify(payload)
    );
  } catch {
    // quota / private mode — ignore
  }
}

export function clearRoListCache(technicianId?: string, dealershipId?: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (technicianId && dealershipId) {
      sessionStorage.removeItem(cacheKey(technicianId, dealershipId));
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}
