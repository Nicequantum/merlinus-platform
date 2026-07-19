import 'server-only';

/**
 * Cloudflare D1 binding resolution.
 *
 * Binding name must match wrangler.toml / Cloudflare dashboard: `DB`.
 * Runtime path: PrismaClient({ adapter: new PrismaD1(getD1Database()) }).
 *
 * OpenNext: prefers getCloudflareContext().env.DB (request / isolate scoped).
 */

export type D1DatabaseLike = {
  prepare: (query: string) => unknown;
  batch?: (statements: unknown[]) => Promise<unknown>;
  exec?: (query: string) => Promise<unknown>;
};

declare global {
  // eslint-disable-next-line no-var -- ambient injection point for D1 binding
  var __MERLIN_D1__: D1DatabaseLike | undefined;
  // eslint-disable-next-line no-var -- some CF shims put bindings on globalThis
  var DB: D1DatabaseLike | undefined;
}

/** Binding name configured in wrangler.toml d1_databases[].binding */
export const D1_BINDING_NAME = 'DB' as const;

function isD1Database(value: unknown): value is D1DatabaseLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as D1DatabaseLike).prepare === 'function'
  );
}

/** True when running under Cloudflare Workers / OpenNext (not local Node). */
export function isCloudflareWorkerRuntime(): boolean {
  if (typeof process !== 'undefined') {
    if (process.env.CF_PAGES === '1' || process.env.CF_PAGES === 'true') return true;
    if (process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING) return true;
  }
  try {
    // Present in workerd; throws or missing in plain Node.
    // Avoid static import so Next build does not require cloudflare:workers.
    // eslint-disable-next-line no-new-func
    const req = Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
    if (req) {
      req('cloudflare:workers');
      return true;
    }
  } catch {
    // not workers
  }
  return typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== 'undefined';
}

/**
 * OpenNext sets `globalThis[Symbol.for("__cloudflare-context__")]` via ALS in
 * `.open-next/cloudflare/init.js` (see runWithCloudflareRequestContext).
 * Prefer this over require('@opennextjs/cloudflare') — that package is often
 * outside the server-function bundle, so dynamic require silently fails in prod.
 */
function readOpenNextAlsDb(): D1DatabaseLike | null {
  try {
    // OpenNext defines this as a getter over AsyncLocalStorage — only set inside a request.
    const ctx = Reflect.get(globalThis, Symbol.for('__cloudflare-context__')) as
      | { env?: Record<string, unknown> }
      | undefined;
    const db = ctx?.env?.[D1_BINDING_NAME];
    if (isD1Database(db)) return db;
  } catch {
    // Outside request context / getter throws
  }
  return null;
}

function readOpenNextPackageDb(): D1DatabaseLike | null {
  try {
    // Dynamic require: available in some local/dev graphs; may be missing in worker bundle.
    // eslint-disable-next-line no-new-func
    const req = Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
    if (!req) return null;
    const mod = req('@opennextjs/cloudflare') as {
      getCloudflareContext?: (opts?: { async?: boolean }) => { env?: Record<string, unknown> };
    };
    if (typeof mod.getCloudflareContext !== 'function') return null;
    const ctx = mod.getCloudflareContext({ async: false });
    const db = ctx?.env?.[D1_BINDING_NAME];
    if (isD1Database(db)) return db;
  } catch {
    // Outside request context or package graph not present
  }
  return null;
}

function readWorkersModuleDb(): D1DatabaseLike | null {
  try {
    // eslint-disable-next-line no-new-func
    const req = Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
    if (!req) return null;
    const workers = req('cloudflare:workers') as { env?: Record<string, unknown> };
    const db = workers?.env?.[D1_BINDING_NAME];
    if (isD1Database(db)) return db;
  } catch {
    // not available
  }
  return null;
}

/** Returns the D1 database binding when running on Cloudflare; otherwise null. */
export function getD1Database(): D1DatabaseLike | null {
  if (isD1Database(globalThis.__MERLIN_D1__)) {
    return globalThis.__MERLIN_D1__;
  }

  if (isD1Database(globalThis.DB)) {
    return globalThis.DB;
  }

  // Production OpenNext path first (ALS / symbol) — most reliable on Workers.
  const fromAls = readOpenNextAlsDb();
  if (fromAls) return fromAls;

  const fromOpenNextPkg = readOpenNextPackageDb();
  if (fromOpenNextPkg) return fromOpenNextPkg;

  const fromWorkers = readWorkersModuleDb();
  if (fromWorkers) return fromWorkers;

  const cloudflareEnv = (globalThis as typeof globalThis & {
    __CLOUDFLARE_ENV__?: Record<string, unknown>;
  }).__CLOUDFLARE_ENV__;
  if (cloudflareEnv && isD1Database(cloudflareEnv[D1_BINDING_NAME])) {
    return cloudflareEnv[D1_BINDING_NAME] as D1DatabaseLike;
  }

  return null;
}

/**
 * Inject D1 binding for the current isolate (tests or CF request bootstrap).
 */
export function setD1Database(db: D1DatabaseLike | null | undefined): void {
  if (db && isD1Database(db)) {
    globalThis.__MERLIN_D1__ = db;
  } else {
    globalThis.__MERLIN_D1__ = undefined;
  }
}

export function isD1Runtime(): boolean {
  return getD1Database() !== null;
}

/** True when Prisma should use the native SQLite file engine (local/dev/tests). */
export function useLocalSqliteFile(): boolean {
  return !isD1Runtime() && !isCloudflareWorkerRuntime();
}
