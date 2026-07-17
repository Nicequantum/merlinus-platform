/**
 * Distributed per-IP rate limiting for API routes (KV INCR + EXPIRE sliding window).
 *
 * KV configured and healthy: distributed limits via Upstash/Vercel KV.
 * Apex production without KV env: fail closed (503) — Phase 6.5.
 * Apex production with KV env but store errors: memory fallback + loud error (login stays up).
 * Merlinus / local: per-instance in-memory fallback when KV missing.
 *
 * Routes pass a stable `routeKey` plus an optional limit override through `withAuth` / `checkRateLimit`.
 */
import { isApexPlatformMode } from '@/lib/platformMode';
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
  /** Video inspection uploads (larger payloads). */
  videoUpload: { limit: 10, windowMs: 60_000 },
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

async function checkKvRateLimit(
  key: string,
  config: RateLimitConfig,
  meta?: { routeKey: string; request: Request }
): Promise<Response | null> {
  const { kv } = await import('@vercel/kv');
  const count = await kv.incr(key);

  if (count === 1) {
    await kv.expire(key, Math.max(1, Math.ceil(config.windowMs / 1000)));
  }

  if (count > config.limit) {
    if (meta) logRateLimitDenied(meta.routeKey, meta.request, 'kv');
    return apiError(RATE_LIMIT_ERROR, 429);
  }

  return null;
}

/** Test helper — clear in-memory counters between rate-limit unit tests. */
export function resetMemoryRateLimitStoreForTests(): void {
  memoryStore.clear();
}

/**
 * True when a Redis/KV REST pair is available for @vercel/kv (or Upstash REST).
 * Accepts both Vercel KV and Upstash marketplace env names.
 */
export function isKvConfigured(): boolean {
  const url =
    process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return Boolean(url && token);
}

/** Ensure @vercel/kv sees standard env names when only Upstash marketplace vars are set. */
function ensureVercelKvEnvAliases(): void {
  if (!process.env.KV_REST_API_URL?.trim() && process.env.UPSTASH_REDIS_REST_URL?.trim()) {
    process.env.KV_REST_API_URL = process.env.UPSTASH_REDIS_REST_URL.trim();
  }
  if (!process.env.KV_REST_API_TOKEN?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
    process.env.KV_REST_API_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN.trim();
  }
}

/** GitHub Actions / local test runners — used for health-check and logging context. */
export function isCiOrTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.CI === 'true' ||
    process.env.GITHUB_ACTIONS === 'true'
  );
}

/**
 * True only on a live Vercel production deployment. Local `next start` / `vercel env pull` may set
 * `VERCEL_ENV=production` without `VERCEL=1` — those runtimes must degrade to in-memory limits.
 */
export function isProductionEnv(): boolean {
  if (isCiOrTestRuntime() || process.env.NODE_ENV === 'development') {
    return false;
  }
  if (process.env.VERCEL !== '1') {
    return false;
  }
  return process.env.VERCEL_ENV === 'production';
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
  'Distributed rate limiting is not available. Apex production requires a configured rate-limit store (Vercel KV / Upstash). Contact your administrator.';

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
          'Apex production missing KV — refusing request (fail-closed). Set KV_REST_API_URL + KV_REST_API_TOKEN and redeploy.',
        ...getRateLimitRuntimeSnapshot(request, routeKey),
      });
      return apiError(APEX_KV_REQUIRED_MESSAGE, 503);
    }
    if (production && authSensitive) {
      logger.error('rate_limit.auth_kv_required', {
        message:
          'KV not configured for auth rate limits in production — falling back to in-memory (weaker multi-instance protection). Set KV_REST_API_URL + KV_REST_API_TOKEN.',
        ...getRateLimitRuntimeSnapshot(request, routeKey),
      });
    }
    logRateLimitDecision(routeKey, request, 'memory');
    return checkMemoryRateLimit(key, memoryRateLimitConfig(config), { routeKey, request });
  }

  try {
    ensureVercelKvEnvAliases();
    const result = await checkKvRateLimit(key, config, { routeKey, request });
    logRateLimitDecision(routeKey, request, 'kv');
    return result;
  } catch (error) {
    // KV is configured but unhealthy (quota, network, auth). Prefer degraded login over total outage.
    logKvRateLimitError(routeKey, request, ip, error);
    if (apexProd) {
      logger.error('rate_limit.apex_kv_unavailable_fallback', {
        message:
          'Apex production KV unavailable — falling back to in-memory rate limits so auth stays available. Investigate Upstash/Vercel KV health or quota.',
        error: error instanceof Error ? error.message : 'unknown',
        ...getRateLimitRuntimeSnapshot(request, routeKey),
      });
    } else if (production && authSensitive) {
      logger.error('rate_limit.auth_kv_unavailable_fallback', {
        message:
          'KV unavailable for auth rate limits in production — falling back to in-memory. Investigate Upstash/Vercel KV health.',
        error: error instanceof Error ? error.message : 'unknown',
        ...getRateLimitRuntimeSnapshot(request, routeKey),
      });
    }
    logRateLimitDecision(routeKey, request, 'kv_fallback_memory');
    return checkMemoryRateLimit(key, memoryRateLimitConfig(config), { routeKey, request });
  }
}
