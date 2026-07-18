import 'server-only';

/**
 * Cloudflare D1 binding resolution.
 *
 * Binding name must match wrangler.toml / Cloudflare dashboard: `DB`.
 * Runtime path: PrismaClient({ adapter: new PrismaD1(getD1Database()) }).
 *
 * Sources (first match wins):
 * 1. Test / adapter injection: globalThis.__MERLIN_D1__
 * 2. Cloudflare Workers module env: cloudflare:workers `env.DB` (when available)
 * 3. globalThis.DB (some CF/OpenNext shims)
 * 4. Otherwise null → local file SQLite via DATABASE_URL=file:./prisma/dev.db
 *
 * Do not import @opennextjs/cloudflare or @cloudflare/next-on-pages here —
 * those packages are optional and break Next.js production builds when absent.
 * CF adapters should inject __MERLIN_D1__ (or expose env.DB on the workers module).
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

/**
 * Read env.DB from the Cloudflare Workers module namespace when present.
 * Uses Function constructor so bundlers do not statically resolve `cloudflare:workers`.
 */
function readWorkersModuleDb(): D1DatabaseLike | null {
  try {
    // Avoid webpack/Next static analysis of optional runtime-only modules.
    const dynamicRequire = Function(
      'return typeof require !== "undefined" ? require : null'
    )() as NodeRequire | null;
    if (!dynamicRequire) return null;
    const workers = dynamicRequire('cloudflare:workers') as {
      env?: Record<string, unknown>;
    };
    const db = workers?.env?.[D1_BINDING_NAME];
    if (isD1Database(db)) return db;
  } catch {
    // Not running on Cloudflare Workers, or module unavailable at build time.
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

  const fromWorkers = readWorkersModuleDb();
  if (fromWorkers) return fromWorkers;

  // OpenNext / next-on-pages often stash request env here after middleware init.
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
 * Prefer calling this from Cloudflare adapter middleware with env.DB.
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
  return !isD1Runtime();
}
