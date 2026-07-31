import 'server-only';

/**
 * Cloudflare Workers KV for distributed rate limits + companion fan-out.
 * Binding name must match wrangler.toml: KV_STORE
 * Namespace: merlinus-rate-limit (id 95aae52266f74a31bf715071664b24b9)
 *
 * Resolution order mirrors R2 / AI queue bindings so OpenNext request context
 * always finds the namespace (ALS symbol → getCloudflareContext → cloudflare:workers → global).
 */

export const KV_STORE_BINDING = 'KV_STORE' as const;

export type WorkersKvLike = {
  get: (key: string, type?: 'text') => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number }
  ) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

function isWorkersKv(value: unknown): value is WorkersKvLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as WorkersKvLike).get === 'function' &&
    typeof (value as WorkersKvLike).put === 'function'
  );
}

function readOpenNextAlsKv(): WorkersKvLike | null {
  try {
    const ctx = Reflect.get(globalThis, Symbol.for('__cloudflare-context__')) as
      | { env?: Record<string, unknown> }
      | undefined;
    const ns = ctx?.env?.[KV_STORE_BINDING];
    if (isWorkersKv(ns)) return ns;
  } catch {
    // outside request
  }
  return null;
}

/** Primary OpenNext path — same helper used for D1 / R2. */
function readOpenNextPackageKv(): WorkersKvLike | null {
  try {
    // eslint-disable-next-line no-new-func
    const req = Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
    if (!req) return null;
    const mod = req('@opennextjs/cloudflare') as {
      getCloudflareContext?: (opts?: { async?: boolean }) => { env?: Record<string, unknown> };
    };
    if (typeof mod.getCloudflareContext !== 'function') return null;
    const ctx = mod.getCloudflareContext({ async: false });
    const ns = ctx?.env?.[KV_STORE_BINDING];
    if (isWorkersKv(ns)) return ns;
  } catch {
    // package graph missing or outside request
  }
  return null;
}

function readWorkersModuleKv(): WorkersKvLike | null {
  try {
    // eslint-disable-next-line no-new-func
    const req = Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
    if (!req) return null;
    const workers = req('cloudflare:workers') as { env?: Record<string, unknown> };
    const ns = workers?.env?.[KV_STORE_BINDING];
    if (isWorkersKv(ns)) return ns;
  } catch {
    // not workers
  }
  return null;
}

/** Returns env.KV_STORE when running on Cloudflare Workers / OpenNext. */
export function getRateLimitKv(): WorkersKvLike | null {
  const fromAls = readOpenNextAlsKv();
  if (fromAls) return fromAls;
  const fromOpenNext = readOpenNextPackageKv();
  if (fromOpenNext) return fromOpenNext;
  const fromWorkers = readWorkersModuleKv();
  if (fromWorkers) return fromWorkers;
  const g = globalThis as typeof globalThis & { KV_STORE?: WorkersKvLike };
  if (isWorkersKv(g.KV_STORE)) return g.KV_STORE;
  return null;
}

export function isWorkersKvConfigured(): boolean {
  return getRateLimitKv() !== null;
}

/**
 * Which resolution path found KV (for health diagnostics — no secrets).
 * Returns null when unbound in this isolate/request.
 */
export function describeKvBindingSource(): string | null {
  if (readOpenNextAlsKv()) return 'openNextAls';
  if (readOpenNextPackageKv()) return 'getCloudflareContext';
  if (readWorkersModuleKv()) return 'cloudflare:workers';
  const g = globalThis as typeof globalThis & { KV_STORE?: WorkersKvLike };
  if (isWorkersKv(g.KV_STORE)) return 'globalThis';
  return null;
}
