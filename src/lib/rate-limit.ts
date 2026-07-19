/**
 * Distributed per-IP rate limiting for API routes.
 *
 * Production (merlinus-platform Worker): native Workers KV via env.KV_STORE
 * (namespace merlinus-rate-limit / id 95aae52266f74a31bf715071664b24b9).
 * Local / missing binding: per-instance memory.
 * Apex production without KV_STORE: fail closed (503).
 */
import { isApexPlatformMode } from '@/lib/platformMode';
import { getRateLimitKv, isWorkersKvConfigured } from '@/lib/storage/workersKv';
import { apiError, RATE_LIMIT_ERROR } from './errors';
import { logger } from './logger';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

/** Per-IP request ceilings (requests per `windowMs`). Override per route via `checkRateLimit` options. */
export const RATE_LIMITS = {
  /** Login, logout, seed — brute-force protection. */
  auth: { limit: 10, windowMs: 60_000 },
  /** Image blob uploads. */
  upload: { limit: 30, windowMs: 60_000 },
  /**
   * Video inspection single-shot / complete / init (heavier operations).
   * Kept moderate to protect R2 + D1 under multi-tenant load.
   */
  videoUpload: { limit: 30, windowMs: 60_000 },
  /**
   * Per-chunk resumable video uploads — multi-minute HD needs many small PUTs.
   * ~3/sec average allows a 100 MiB video at 1 MiB chunks within ~1 minute of network time.
   */
  videoUploadChunk: { limit: 240, windowMs: 60_000 },
  /** Customer SMS sends. */
  sms: { limit: 10, windowMs: 60_000 },
  /** Grok-backed routes: story generate/review/score, RO + diagnostic vision extract. */
  generate: { limit: 20, windowMs: 60_000 },
  grok: { limit: 20, windowMs: 60_000 },
  /** Desktop companion publish (navigation/status/activity). */
  companionPublish: { limit: 90, windowMs: 60_000 },
  /** Companion poll / SSE connect (chatty but authenticated). */
  companion: { limit: 180, windowMs: 60_000 },
  /** General authenticated API traffic. */
  default: { limit: 60, windowMs: 60_000 },
} as const;

/** Auth-sensitive route keys that require distributed KV limits in production. */
export function isAuthRateLimitRoute(routeKey: string): boolean {
  const key = routeKey.trim().toLowerCase();
  return (
    key === 'auth' ||
    key.startsWith('auth.') ||
    key.includes('login') ||
    key.includes('password') ||
    key.includes('seed')
  );
}

/** Legacy message kept for API compatibility; KV outages no longer return HTTP 503. */
export const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  'Service temporarily unavailable. Contact your administrator to configure rate limiting.';

import { getClientIp, getRequestIp } from './requestIp';

export { getClientIp, getRequestIp };

function checkMemoryRateLimit(
  key: string,
  config: RateLimitConfig,
  meta?: { routeKey: string; request: Request }
): Response | null {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now >= entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  if (entry.count >= config.limit) {
    if (meta) logRateLimitDenied(meta.routeKey, meta.request, 'memory');
    return apiError(RATE_LIMIT_ERROR, 429);
  }

  entry.count += 1;
  return null;
}

/**
 * Per-key serialize within a single Worker isolate (sync + async re-entrancy safe).
 * Cross-isolate safety is provided by compare-and-swap below.
 */
const kvKeyGates = new Map<string, Promise<void>>();

async function withKvKeyGate<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = kvKeyGates.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => gate);
  kvKeyGates.set(key, chained);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (kvKeyGates.get(key) === chained) {
      kvKeyGates.delete(key);
    }
  }
}

/** Stored rate-limit bucket — version + writerId enable CAS across isolates. */
interface KvRateLimitBucket {
  count: number;
  resetAt: number;
  version: number;
  writerId: string;
}

function parseKvBucket(raw: string | null, now: number, windowMs: number): KvRateLimitBucket {
  if (!raw) {
    return { count: 0, resetAt: now + windowMs, version: 0, writerId: '' };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<KvRateLimitBucket>;
    if (
      typeof parsed.count === 'number' &&
      typeof parsed.resetAt === 'number' &&
      typeof parsed.version === 'number'
    ) {
      if (now >= parsed.resetAt) {
        return {
          count: 0,
          resetAt: now + windowMs,
          version: parsed.version,
          writerId: '',
        };
      }
      return {
        count: parsed.count,
        resetAt: parsed.resetAt,
        version: parsed.version,
        writerId: typeof parsed.writerId === 'string' ? parsed.writerId : '',
      };
    }
  } catch {
    // Legacy plain integer counter from pre-CAS deployments
    const prev = Number.parseInt(raw, 10);
    if (Number.isFinite(prev) && prev >= 0) {
      return { count: prev, resetAt: now + windowMs, version: 0, writerId: '' };
    }
  }
  return { count: 0, resetAt: now + windowMs, version: 0, writerId: '' };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atomic KV increment via compare-and-swap:
 * 1) read bucket
 * 2) write candidate with unique writerId + incremented version
 * 3) re-read; succeed only if writerId still matches (we won the last write)
 * 4) otherwise retry with backoff
 *
 * Same-isolate callers are serialized with withKvKeyGate to avoid busy CAS loops.
 * Exhausted CAS retries throw (auth routes fail closed; others may memory-fallback).
 */
export async function atomicKvIncrement(
  ns: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  },
  key: string,
  config: RateLimitConfig,
  options?: { maxAttempts?: number }
): Promise<number> {
  const maxAttempts = options?.maxAttempts ?? 16;
  const ttlSec = Math.max(1, Math.ceil(config.windowMs / 1000));

  return withKvKeyGate(key, async () => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const now = Date.now();
      const current = parseKvBucket(await ns.get(key), now, config.windowMs);
      const writerId = `${now.toString(36)}-${attempt}-${Math.random().toString(36).slice(2, 10)}`;
      const next: KvRateLimitBucket = {
        count: current.count + 1,
        resetAt: current.resetAt,
        version: current.version + 1,
        writerId,
      };

      await ns.put(key, JSON.stringify(next), { expirationTtl: ttlSec });

      const verifiedRaw = await ns.get(key);
      if (!verifiedRaw) {
        await sleepMs(Math.min(40, 1 + attempt * 2) + Math.random() * 4);
        continue;
      }

      let verified: KvRateLimitBucket;
      try {
        verified = JSON.parse(verifiedRaw) as KvRateLimitBucket;
      } catch {
        await sleepMs(Math.min(40, 1 + attempt * 2) + Math.random() * 4);
        continue;
      }

      // CAS success: our write is the current value
      if (verified.writerId === writerId && verified.version === next.version) {
        return verified.count;
      }

      // Lost race — another isolate committed; retry from latest state
      await sleepMs(Math.min(50, 2 ** Math.min(attempt, 5)) + Math.random() * 8);
    }

    throw new Error('rate_limit_cas_exhausted');
  });
}

/**
 * Native Workers KV rate limit via env.KV_STORE.
 * Uses compare-and-swap (atomicKvIncrement) — not a racy get→increment→put.
 */
async function checkWorkersKvRateLimit(
  key: string,
  config: RateLimitConfig,
  meta?: { routeKey: string; request: Request }
): Promise<Response | null> {
  const ns = getRateLimitKv();
  if (!ns) throw new Error('KV_STORE binding missing — check wrangler.toml [[kv_namespaces]]');

  const count = await atomicKvIncrement(ns, key, config);

  if (count > config.limit) {
    if (meta) logRateLimitDenied(meta.routeKey, meta.request, 'kv');
    return apiError(RATE_LIMIT_ERROR, 429);
  }
  return null;
}

async function checkKvRateLimit(
  key: string,
  config: RateLimitConfig,
  meta?: { routeKey: string; request: Request }
): Promise<Response | null> {
  // Production path: native Workers KV only (no Vercel/Upstash REST).
  return checkWorkersKvRateLimit(key, config, meta);
}

/** Test helper — clear in-memory counters between rate-limit unit tests. */
export function resetMemoryRateLimitStoreForTests(): void {
  memoryStore.clear();
}

/** True when env.KV_STORE (Workers KV) is available for distributed rate limits. */
export function isKvConfigured(): boolean {
  return isWorkersKvConfigured();
}

/** GitHub Actions / local test runners — used for health-check and logging context. */
export function isCiOrTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.CI === 'true' ||
    process.env.GITHUB_ACTIONS === 'true'
  );
}

function isTruthyProductionFlag(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * True on a live production deployment (Vercel **or** Cloudflare Workers / OpenNext).
 *
 * - Vercel: `VERCEL=1` + `VERCEL_ENV=production`
 * - Cloudflare: workerd / OpenNext request context, or explicit `MERLIN_PRODUCTION=1`
 * - Local `next start` (NODE_ENV=production only) → false (weaker in-memory rate limits OK)
 * - CI / test → false
 */
export function isProductionEnv(): boolean {
  if (isCiOrTestRuntime() || process.env.NODE_ENV === 'development') {
    return false;
  }

  // Explicit ops flag — set as Wrangler secret on production Workers.
  if (isTruthyProductionFlag(process.env.MERLIN_PRODUCTION)) {
    return true;
  }

  // Vercel production
  if (process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production') {
    return true;
  }

  // Cloudflare Pages / Workers indicators (OpenNext sets OPEN_NEXT_ORIGIN per request)
  if (process.env.CF_PAGES === '1' || process.env.CF_PAGES === 'true') {
    return process.env.NODE_ENV === 'production';
  }
  if (process.env.OPEN_NEXT_ORIGIN?.trim() && process.env.NODE_ENV === 'production') {
    return true;
  }
  // workerd runtime (Workers + nodejs_compat)
  if (
    process.env.NODE_ENV === 'production' &&
    typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== 'undefined'
  ) {
    return true;
  }

  return false;
}

/** Loopback or RFC1918 host — local dev, next start, vercel dev, shop-floor LAN tablets. */
export function isLocalhostRequest(request: Request): boolean {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
    if (hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') return true;

    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const octets = ipv4.slice(1, 5).map((part) => Number(part));
    if (octets.some((part) => part > 255)) return false;
    const [a, b] = octets;
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return false;
  }
}

export function getRateLimitRuntimeSnapshot(request: Request, routeKey: string) {
  return {
    requestUrl: request.url,
    routeKey,
    nodeEnv: process.env.NODE_ENV ?? null,
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    kvConfigured: isKvConfigured(),
    isProductionEnv: isProductionEnv(),
    isLocalhost: isLocalhostRequest(request),
  };
}

function logRateLimitDecision(
  routeKey: string,
  request: Request,
  decision: 'kv' | 'memory' | 'kv_fallback_memory'
): void {
  // Phase 7.2 H10 — success path is debug-only (was flooding production info logs)
  logger.debug('rate_limit.check', {
    decision,
    ...getRateLimitRuntimeSnapshot(request, routeKey),
  });
}

/** Phase 7.2 — log denials at warn (signal) without per-request success noise. */
function logRateLimitDenied(routeKey: string, request: Request, backend: 'kv' | 'memory'): void {
  logger.warn('rate_limit.denied', {
    backend,
    ...getRateLimitRuntimeSnapshot(request, routeKey),
  });
}

function logKvRateLimitError(routeKey: string, request: Request, ip: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : 'unknown';
  logger.warn('rate_limit.kv_fallback_memory', {
    ip: ip === 'unknown' ? undefined : ip,
    error: errorMessage,
    ...getRateLimitRuntimeSnapshot(request, routeKey),
  });
}

/** Weaker per-instance limits when KV is not configured (local dev / CI). */
function memoryRateLimitConfig(config: RateLimitConfig): RateLimitConfig {
  if (isKvConfigured()) return config;
  return {
    limit: Math.max(1, Math.floor(config.limit / 2)),
    windowMs: config.windowMs,
  };
}

/**
 * Phase 6.5 — Apex production must configure KV (no silent "never set it up").
 * Missing env → 503. Runtime KV outage (quota, network) → memory fallback + loud log
 * so owner login is not hard-down when Upstash hits max-request limits.
 */
function apexProductionRequiresKv(): boolean {
  return isProductionEnv() && isApexPlatformMode();
}

/** Public message — avoid raw env var names (client redaction turns them into noise). */
const APEX_KV_REQUIRED_MESSAGE =
  'Distributed rate limiting is not available. Production requires the KV_STORE Workers KV binding. Contact your administrator.';

export async function checkRateLimit(
  request: Request,
  routeKey: string,
  config: RateLimitConfig = RATE_LIMITS.default
): Promise<Response | null> {
  const ip = getClientIp(request);
  const key = `ratelimit:${routeKey}:${ip === 'unknown' ? 'unknown' : ip}`;
  const authSensitive = isAuthRateLimitRoute(routeKey);
  const production = isProductionEnv();
  const apexProd = apexProductionRequiresKv();

  if (!isKvConfigured()) {
    // Only fail closed when KV was never wired — ops must connect Vercel Storage → KV.
    if (apexProd) {
      logger.error('rate_limit.apex_kv_required', {
        message:
          'Apex production missing KV_STORE binding — refusing request (fail-closed). Add [[kv_namespaces]] binding = "KV_STORE" and redeploy.',
        ...getRateLimitRuntimeSnapshot(request, routeKey),
      });
      return apiError(APEX_KV_REQUIRED_MESSAGE, 503);
    }
    if (production && authSensitive) {
      logger.error('rate_limit.auth_kv_required', {
        message:
          'KV_STORE not available for auth rate limits in production — falling back to in-memory (weaker multi-instance protection).',
        ...getRateLimitRuntimeSnapshot(request, routeKey),
      });
    }
    logRateLimitDecision(routeKey, request, 'memory');
    return checkMemoryRateLimit(key, memoryRateLimitConfig(config), { routeKey, request });
  }

  try {
    const result = await checkKvRateLimit(key, config, { routeKey, request });
    logRateLimitDecision(routeKey, request, 'kv');
    return result;
  } catch (error) {
    logKvRateLimitError(routeKey, request, ip, error);
    // Auth-sensitive routes in production fail closed — no multi-isolate memory bypass.
    if (production && authSensitive) {
      logger.error('rate_limit.auth_kv_unavailable_fail_closed', {
        message:
          'KV_STORE unavailable for auth rate limits in production — refusing request (fail-closed). Check wrangler.toml [[kv_namespaces]] binding = "KV_STORE".',
        error: error instanceof Error ? error.message : 'unknown',
        ...getRateLimitRuntimeSnapshot(request, routeKey),
      });
      return apiError(APEX_KV_REQUIRED_MESSAGE, 503);
    }
    if (apexProd) {
      logger.error('rate_limit.apex_kv_unavailable_fallback', {
        message:
          'Apex production KV_STORE unavailable — non-auth routes fall back to in-memory. Auth stays fail-closed.',
        error: error instanceof Error ? error.message : 'unknown',
        ...getRateLimitRuntimeSnapshot(request, routeKey),
      });
    }
    logRateLimitDecision(routeKey, request, 'kv_fallback_memory');
    return checkMemoryRateLimit(key, memoryRateLimitConfig(config), { routeKey, request });
  }
}
