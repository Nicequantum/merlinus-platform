import 'server-only';

/**
 * Cloudflare D1 binding resolution.
 *
 * Binding name must match wrangler.toml / Cloudflare dashboard: `DB`.
 * Runtime path: PrismaClient({ adapter: new PrismaD1(getD1Database()) }).
 *
 * Sources (first match wins):
 * 1. Explicit process injection for tests: globalThis.__MERLIN_D1__
 * 2. Cloudflare Workers / Pages request context (getRequestContext / getCloudflareContext)
 * 3. Node process env shim is never a real D1Database — returns null for local file SQLite.
 */

export type D1DatabaseLike = {
  prepare: (query: string) => unknown;
  batch?: (statements: unknown[]) => Promise<unknown>;
  exec?: (query: string) => Promise<unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __MERLIN_D1__: D1DatabaseLike | undefined;
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
 * Attempt to read env.DB from Cloudflare request context without hard-requiring CF packages.
 */
function readCloudflareEnvDb(): D1DatabaseLike | null {
  // OpenNext / @opennextjs/cloudflare
  try {
    // Dynamic require keeps Node/Vercel builds working when the package is absent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@opennextjs/cloudflare') as {
      getCloudflareContext?: (opts?: { async?: boolean }) => { env?: Record<string, unknown> };
    };
    const ctx = mod.getCloudflareContext?.();
    const db = ctx?.env?.[D1_BINDING_NAME];
    if (isD1Database(db)) return db;
  } catch {
    // package not installed or not in CF runtime
  }

  // @cloudflare/next-on-pages
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@cloudflare/next-on-pages') as {
      getRequestContext?: () => { env?: Record<string, unknown> };
    };
    const ctx = mod.getRequestContext?.();
    const db = ctx?.env?.[D1_BINDING_NAME];
    if (isD1Database(db)) return db;
  } catch {
    // package not installed
  }

  return null;
}

/** Returns the D1 database binding when running on Cloudflare; otherwise null. */
export function getD1Database(): D1DatabaseLike | null {
  if (isD1Database(globalThis.__MERLIN_D1__)) {
    return globalThis.__MERLIN_D1__;
  }
  return readCloudflareEnvDb();
}

export function isD1Runtime(): boolean {
  return getD1Database() !== null;
}

/** True when Prisma should use the native SQLite file engine (local/dev/tests). */
export function useLocalSqliteFile(): boolean {
  return !isD1Runtime();
}
