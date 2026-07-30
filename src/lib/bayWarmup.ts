/**
 * Bay tablet cold-start strategy — aggressive isolate + data path warming.
 * Safe to call fire-and-forget after login / shell mount.
 *
 * Goal: first RO scan (upload + extract + create) hits a hot Worker + D1 + R2
 * without a hanging "populating" state. Multi-pass + readiness gate.
 */
import { fetchWithClientRetry, keepAlivePublicStatus, warmSessionIsolate } from '@/lib/clientFetchRetry';
import { writeRoListCache } from '@/lib/roListCache';
import type { RepairOrderSummary } from '@/types';

export interface BayWarmupResult {
  sessionWarm: boolean;
  roListPrefetched: boolean;
  statusPing: boolean;
  /** Session warmup includes R2 probe + AuditLog base path when dealership present */
  uploadPathWarmed: boolean;
  ocrWarmed: boolean;
  durationMs: number;
}

let lastBayReadyAt = 0;
let inFlightBayWarm: Promise<BayWarmupResult> | null = null;
const BAY_READY_TTL_MS = 90_000;

export function isBayScanReady(now = Date.now()): boolean {
  return lastBayReadyAt > 0 && now - lastBayReadyAt < BAY_READY_TTL_MS;
}

export function markBayScanReady(): void {
  lastBayReadyAt = Date.now();
  try {
    void import('@/lib/bayUploadReady').then(({ markUploadPathReady }) =>
      markUploadPathReady()
    );
  } catch {
    // ignore
  }
}

/**
 * After login or shell mount: warm D1/auth/R2/audit, prefetch today's RO list, ping status.
 * Parallel where safe so first RO capture + Process RO hit a hot isolate.
 */
export async function runAggressiveBayWarmup(options?: {
  /** Prefetch today's RO list into sessionStorage for instant paint */
  prefetchRoList?: boolean;
  technicianId?: string;
  dealershipId?: string;
  /** Also kick Tesseract WASM warm (default true) */
  warmOcr?: boolean;
}): Promise<BayWarmupResult> {
  if (inFlightBayWarm) {
    return inFlightBayWarm;
  }

  inFlightBayWarm = (async () => {
    const started = Date.now();
    const prefetchRoList = options?.prefetchRoList !== false;
    const warmOcr = options?.warmOcr !== false;

    // Pass 1 — session (R2 + audit + D1 + RLS create path)
    const sessionWarm1 = await warmSessionIsolate();

    // Pass 2 — parallel: status, RO list, second session warm, OCR WASM
    const [statusPing, roPrefetch, sessionWarm2, ocrWarmed] = await Promise.all([
      keepAlivePublicStatus(),
      prefetchRoList
        ? prefetchTodayRoList({
            technicianId: options?.technicianId,
            dealershipId: options?.dealershipId,
          })
        : Promise.resolve(false),
      warmSessionIsolate(),
      warmOcr
        ? import('@/services/ocr')
            .then((m) => m.warmupOcrWorker())
            .then(() => true)
            .catch(() => false)
        : Promise.resolve(false),
    ]);

    // Pass 3 — final session warm after list hit (isolate often fully hot only on 3rd)
    const sessionWarm3 = await warmSessionIsolate();

    const sessionWarm = sessionWarm1 || sessionWarm2 || sessionWarm3;
    if (sessionWarm) {
      markBayScanReady();
    }

    return {
      sessionWarm,
      roListPrefetched: roPrefetch,
      statusPing,
      uploadPathWarmed: sessionWarm,
      ocrWarmed,
      durationMs: Date.now() - started,
    };
  })().finally(() => {
    inFlightBayWarm = null;
  });

  return inFlightBayWarm;
}

/**
 * Await until bay paths are warm enough for first RO scan.
 * Call from Scan RO / Process RO before upload/extract.
 */
export async function ensureBayScanReady(options?: {
  technicianId?: string;
  dealershipId?: string;
  maxWaitMs?: number;
  force?: boolean;
}): Promise<BayWarmupResult> {
  const maxWaitMs = options?.maxWaitMs ?? 14_000;
  if (!options?.force && isBayScanReady()) {
    return {
      sessionWarm: true,
      roListPrefetched: true,
      statusPing: true,
      uploadPathWarmed: true,
      ocrWarmed: true,
      durationMs: 0,
    };
  }

  const warmPromise = runAggressiveBayWarmup({
    prefetchRoList: true,
    technicianId: options?.technicianId,
    dealershipId: options?.dealershipId,
    warmOcr: true,
  });

  // Also force upload-path gate in parallel
  const uploadPromise = import('@/lib/bayUploadReady').then(({ ensureUploadPathReady }) =>
    ensureUploadPathReady({ force: options?.force, maxWaitMs: Math.min(maxWaitMs, 12_000) })
  );

  const raced = await Promise.race([
    Promise.all([warmPromise, uploadPromise]).then(([w]) => w),
    new Promise<BayWarmupResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            sessionWarm: isBayScanReady(),
            roListPrefetched: false,
            statusPing: false,
            uploadPathWarmed: isBayScanReady(),
            ocrWarmed: false,
            durationMs: maxWaitMs,
          }),
        maxWaitMs
      )
    ),
  ]);
  return raced;
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
  const MIN_GAP_MS = 15_000;

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
    void runAggressiveBayWarmup({
      prefetchRoList: true,
      technicianId: options?.technicianId,
      dealershipId: options?.dealershipId,
    });
  };
  window.addEventListener('online', onOnline);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
  };
}
