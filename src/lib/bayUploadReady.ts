/**
 * Bay photo upload readiness — cold-start gate for RO scan + Xentry captures.
 *
 * First login / first rooftop enter often hits a cold Worker isolate + cold R2 binding.
 * Without a real readiness gate, the first camera capture stays on "Saving…" forever
 * (or until a 60s timeout) while a second open works instantly.
 */

import { clientLog } from '@/lib/clientLog';

export type UploadWarmDetail = {
  ok: boolean;
  r2: boolean;
  db: boolean;
  durationMs: number;
};

let lastReadyAt = 0;
let inFlightWarm: Promise<UploadWarmDetail> | null = null;

/** Consider R2/upload path hot for this long after a successful warm. */
const READY_TTL_MS = 45_000;

/** Serialize first-wave uploads so cold R2 is not thrashed by 3–6 parallel puts. */
const UPLOAD_SLOT_CONCURRENCY = 2;
let activeSlots = 0;
const slotWaiters: Array<() => void> = [];

function acquireUploadSlot(): Promise<void> {
  if (activeSlots < UPLOAD_SLOT_CONCURRENCY) {
    activeSlots += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    slotWaiters.push(() => {
      activeSlots += 1;
      resolve();
    });
  });
}

function releaseUploadSlot(): void {
  activeSlots = Math.max(0, activeSlots - 1);
  const next = slotWaiters.shift();
  if (next) next();
}

/** Run work with bounded upload concurrency (RO scan + Xentry share the pool). */
export async function withUploadSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireUploadSlot();
  try {
    return await fn();
  } finally {
    releaseUploadSlot();
  }
}

export function markUploadPathReady(): void {
  lastReadyAt = Date.now();
}

export function isUploadPathReady(now = Date.now()): boolean {
  return lastReadyAt > 0 && now - lastReadyAt < READY_TTL_MS;
}

async function probeWarmSession(): Promise<UploadWarmDetail> {
  const started = Date.now();
  try {
    const { fetchWithClientRetry } = await import('@/lib/clientFetchRetry');
    const res = await fetchWithClientRetry('/api/session/warmup', {
      method: 'GET',
      timeoutMs: 12_000,
      maxRetries: 2,
    });
    if (!res.ok) {
      return { ok: false, r2: false, db: false, durationMs: Date.now() - started };
    }
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      paths?: { r2?: boolean; db?: boolean };
    };
    const r2 = Boolean(body.paths?.r2);
    const db = body.paths?.db !== false;
    const ok = body.ok !== false && db;
    // R2 probe failure is still a soft failure — upload may work if list was flaky.
    if (ok && r2) {
      markUploadPathReady();
    }
    return { ok, r2, db, durationMs: Date.now() - started };
  } catch (error) {
    clientLog.warn('bay.upload_warm_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, r2: false, db: false, durationMs: Date.now() - started };
  }
}

/**
 * Ensure session + R2 path is warm before the first capture upload.
 * Dedupes concurrent callers; reuses a recent successful warm.
 */
export async function ensureUploadPathReady(options?: {
  /** Force a new warm even if recently ready. */
  force?: boolean;
  /** Max time to wait for warm (ms). */
  maxWaitMs?: number;
}): Promise<UploadWarmDetail> {
  const maxWaitMs = options?.maxWaitMs ?? 10_000;
  if (!options?.force && isUploadPathReady()) {
    return { ok: true, r2: true, db: true, durationMs: 0 };
  }

  if (!inFlightWarm) {
    inFlightWarm = (async () => {
      // Up to 2 probes — first often only boots the isolate; second hits hot R2.
      let last = await probeWarmSession();
      if (!last.ok || !last.r2) {
        await new Promise((r) => setTimeout(r, 400));
        last = await probeWarmSession();
      }
      // Soft-mark ready on DB-ok even if R2 list was flaky (upload retries still apply).
      if (last.ok) markUploadPathReady();
      return last;
    })().finally(() => {
      inFlightWarm = null;
    });
  }

  const raced = await Promise.race([
    inFlightWarm,
    new Promise<UploadWarmDetail>((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: isUploadPathReady(),
            r2: isUploadPathReady(),
            db: isUploadPathReady(),
            durationMs: maxWaitMs,
          }),
        maxWaitMs
      )
    ),
  ]);
  return raced;
}

/**
 * Pre-warm for bay shell / scan mount — fire-and-forget safe.
 * Prefer awaiting ensureUploadPathReady before the first Process RO / first capture.
 */
export function kickBayUploadWarm(): void {
  void ensureUploadPathReady({ maxWaitMs: 12_000 }).catch(() => undefined);
}
