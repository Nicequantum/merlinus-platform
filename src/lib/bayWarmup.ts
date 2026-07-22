/**
 * Bay tablet cold-start strategy — aggressive isolate + data path warming.
 * Safe to call fire-and-forget after login / shell mount.
 */
import { fetchWithClientRetry, keepAlivePublicStatus, warmSessionIsolate } from '@/lib/clientFetchRetry';
import { writeRoListCache } from '@/lib/roListCache';
import type { RepairOrderSummary } from '@/types';

export interface BayWarmupResult {
  sessionWarm: boolean;
  roListPrefetched: boolean;
  statusPing: boolean;
  durationMs: number;
}

/**
 * After login or shell mount: warm D1/auth, prefetch today's RO list, ping status.
 * Parallel where safe so first open-RO click hits a hot isolate.
 */
export async function runAggressiveBayWarmup(options?: {
  /** Prefetch today's RO list into sessionStorage for instant paint */
  prefetchRoList?: boolean;
  technicianId?: string;
  dealershipId?: string;
}): Promise<BayWarmupResult> {
  const started = Date.now();
  const prefetchRoList = options?.prefetchRoList !== false;

  const [sessionWarm, statusPing, roPrefetch] = await Promise.all([
    warmSessionIsolate(),
    keepAlivePublicStatus(),
    prefetchRoList
      ? prefetchTodayRoList({
          technicianId: options?.technicianId,
          dealershipId: options?.dealershipId,
        })
      : Promise.resolve(false),
  ]);

  return {
    sessionWarm,
    roListPrefetched: roPrefetch,
    statusPing,
    durationMs: Date.now() - started,
  };
}

/** Prefetch GET /api/repair-orders?scope=today and seed session cache. */
export async function prefetchTodayRoList(options?: {
  technicianId?: string;
  dealershipId?: string;
}): Promise<boolean> {
  try {
    const res = await fetchWithClientRetry('/api/repair-orders?scope=today', {
      method: 'GET',
      timeoutMs: 15_000,
      maxRetries: 2,
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as {
      repairOrders?: RepairOrderSummary[];
      todayStart?: string;
    };
    if (!Array.isArray(data.repairOrders)) return false;
    if (options?.technicianId && options?.dealershipId) {
      writeRoListCache({
        technicianId: options.technicianId,
        dealershipId: options.dealershipId,
        repairOrders: data.repairOrders,
        todayStart: data.todayStart ?? null,
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Visibility-aware keep-alive: warm aggressively when tab becomes visible again
 * (tablet sleep / app switch is the #1 cold-start cause on the bay floor).
 */
export function startVisibilityBayWarmup(options?: {
  technicianId?: string;
  dealershipId?: string;
}): () => void {
  if (typeof document === 'undefined') return () => undefined;

  let lastWarm = 0;
  const MIN_GAP_MS = 20_000;

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastWarm < MIN_GAP_MS) return;
    lastWarm = now;
    void runAggressiveBayWarmup({
      prefetchRoList: true,
      technicianId: options?.technicianId,
      dealershipId: options?.dealershipId,
    });
  };

  document.addEventListener('visibilitychange', onVisible);
  // Also warm when network returns (Wi‑Fi blip)
  const onOnline = () => {
    lastWarm = 0;
    onVisible();
  };
  window.addEventListener('online', onOnline);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
  };
}
