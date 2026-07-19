import 'server-only';

/**
 * Prisma client for Merlinus / Apex on Cloudflare Workers + local Node.
 *
 * Workers / OpenNext login path:
 *   getDb() → getCloudflareContext({ async: true }).env.DB → PrismaD1 → WASM PrismaClient
 * Never open file SQLite or load the Node library engine (unenv: fs.readdir / readFileSync).
 *
 * Local Node / CI:
 *   getDb() / getPrisma() → better-sqlite3 adapter + Node PrismaClient
 */
import type { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import {
  getD1Database,
  isCloudflareWorkerRuntime,
  isD1Runtime,
  setD1Database,
  type D1DatabaseLike,
} from '@/lib/d1';
import { logger } from './logger';
import { withDbConnectionRetry } from './dbRetry';

type PrismaClientConstructor = new (args?: {
  adapter?: unknown;
  log?: Array<'error' | 'warn'>;
}) => PrismaClient;

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  prismaD1?: boolean;
  prismaD1Binding?: D1DatabaseLike | null;
};

export const LOCAL_SQLITE_URL = 'file:./prisma/dev.db';

function ensureLocalDatabaseUrl(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = LOCAL_SQLITE_URL;
  }
}

function prismaLogLevel(): Array<'error' | 'warn'> {
  return process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'];
}

/** True only for plain Node (CI/dev) — never Workers / OpenNext. */
function isPlainNodeRuntime(): boolean {
  if (typeof process === 'undefined' || !process.versions?.node) return false;
  if (typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== 'undefined') {
    return false;
  }
  if (process.env.CF_PAGES === '1' || process.env.CF_PAGES === 'true') return false;
  if (process.env.OPEN_NEXT_ORIGIN?.trim()) return false;
  if (process.env.NEXT_RUNTIME === 'edge') return false;
  if (isCloudflareWorkerRuntime()) return false;
  return true;
}

/**
 * Prisma CLI resolves relative `file:` URLs against the schema directory (`prisma/`).
 * Node-only helper.
 */
export function resolveLocalSqliteFilePath(databaseUrl: string): string {
  const path = getNodeRequire()('node:path') as typeof import('node:path');
  const stripped = databaseUrl.trim().replace(/^file:/i, '');
  if (!stripped) {
    return path.resolve(process.cwd(), 'prisma', 'dev.db');
  }
  if (path.isAbsolute(stripped)) {
    return stripped;
  }
  return path.resolve(path.join(process.cwd(), 'prisma'), stripped);
}

/**
 * Workers: @prisma/client/wasm (no native engine, no fs).
 * Node: @prisma/client (library engine + better-sqlite3 adapter).
 *
 * Never statically import `@prisma/client` default entry — webpack would bundle
 * the library engine and unenv would throw on fs.readFileSync at login.
 */
async function loadPrismaClientCtor(preferWasm: boolean): Promise<PrismaClientConstructor> {
  if (preferWasm) {
    try {
      const wasm = (await import('@prisma/client/wasm')) as {
        PrismaClient: PrismaClientConstructor;
      };
      return wasm.PrismaClient;
    } catch {
      // fall through to default
    }
  }
  const node = (await import('@prisma/client')) as { PrismaClient: PrismaClientConstructor };
  return node.PrismaClient;
}

function getNodeRequire(): NodeRequire {
  // Prefer createRequire so this works under tsx/ESM (global require is undefined).
  // Node-only — never called on Workers. Dynamic require avoids bundling node:module into workerd.
  const nodeModule = require('node:module') as typeof import('node:module');
  const filename =
    typeof __filename !== 'undefined' ? __filename : `${process.cwd()}/package.json`;
  return nodeModule.createRequire(filename);
}

function loadPrismaClientCtorSync(preferWasm: boolean): PrismaClientConstructor {
  const req = getNodeRequire();
  if (preferWasm) {
    try {
      const wasm = req('@prisma/client/wasm') as { PrismaClient: PrismaClientConstructor };
      if (wasm?.PrismaClient) return wasm.PrismaClient;
    } catch {
      // fall through
    }
  }
  return (req('@prisma/client') as { PrismaClient: PrismaClientConstructor }).PrismaClient;
}

async function createD1PrismaClient(d1: D1DatabaseLike): Promise<PrismaClient> {
  logger.info('db.backend', { backend: 'cloudflare_d1', binding: 'DB' });
  const adapter = new PrismaD1(d1 as ConstructorParameters<typeof PrismaD1>[0]);
  // Always WASM on non-Node so workerd never loads library engine + fs.
  const PrismaClientCtor = await loadPrismaClientCtor(!isPlainNodeRuntime());
  return new PrismaClientCtor({
    adapter,
    log: prismaLogLevel(),
  });
}

function createD1PrismaClientSync(d1: D1DatabaseLike): PrismaClient {
  logger.info('db.backend', { backend: 'cloudflare_d1', binding: 'DB' });
  const adapter = new PrismaD1(d1 as ConstructorParameters<typeof PrismaD1>[0]);
  const PrismaClientCtor = loadPrismaClientCtorSync(!isPlainNodeRuntime());
  return new PrismaClientCtor({
    adapter,
    log: prismaLogLevel(),
  });
}

function createFileSqlitePrismaClient(databaseUrl: string): PrismaClient {
  if (!isPlainNodeRuntime()) {
    throw new Error('File SQLite is only available on plain Node (not Workers)');
  }
  const req = getNodeRequire();
  const { mkdirSync } = req('node:fs') as typeof import('node:fs');
  const path = req('node:path') as typeof import('node:path');
  const { PrismaBetterSQLite3 } = req(
    '@prisma/adapter-better-sqlite3'
  ) as typeof import('@prisma/adapter-better-sqlite3');
  const { PrismaClient: NodePrismaClient } = req('@prisma/client') as {
    PrismaClient: PrismaClientConstructor;
  };
  const filePath = resolveLocalSqliteFilePath(databaseUrl);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const adapter = new PrismaBetterSQLite3({ url: filePath });
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    logger.info('db.backend', {
      backend: 'sqlite_file_adapter',
      path: filePath.endsWith('dev.db') ? filePath : '***',
    });
  }
  return new NodePrismaClient({
    adapter,
    log: prismaLogLevel(),
  });
}

/**
 * Resolve D1 via OpenNext getCloudflareContext (async) then fall back to getD1Database().
 */
export async function resolveD1Database(): Promise<D1DatabaseLike | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext({ async: true });
    const env = (ctx as unknown as { env?: { DB?: D1DatabaseLike } }).env;
    const db = env?.DB;
    if (db && typeof db === 'object' && typeof db.prepare === 'function') {
      setD1Database(db);
      return db;
    }
  } catch {
    // Outside Workers / request context
  }
  return getD1Database();
}

/**
 * Preferred entry for all request handlers (login, auth, API).
 * Workers: PrismaD1(env.DB) + WASM client — zero filesystem access.
 */
export async function getDb(): Promise<PrismaClient> {
  const d1 = await resolveD1Database();
  if (d1) {
    if (
      globalForPrisma.prisma &&
      globalForPrisma.prismaD1 &&
      globalForPrisma.prismaD1Binding === d1
    ) {
      return globalForPrisma.prisma;
    }
    const client = await createD1PrismaClient(d1);
    globalForPrisma.prisma = client;
    globalForPrisma.prismaD1 = true;
    globalForPrisma.prismaD1Binding = d1;
    return client;
  }

  if (!isPlainNodeRuntime()) {
    throw new Error(
      'No D1 binding `DB`. On Cloudflare Workers, env.DB must be available via getCloudflareContext. Check wrangler.toml [[d1_databases]] binding = "DB".'
    );
  }

  return getPrisma();
}

/**
 * Sync accessor for Node/CI and legacy call sites.
 * Prefer getDb() on Workers request paths.
 */
export function getPrisma(): PrismaClient {
  const d1 = getD1Database();
  const wantD1 = Boolean(d1);

  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaD1 === wantD1 &&
    globalForPrisma.prismaD1Binding === d1
  ) {
    return globalForPrisma.prisma;
  }

  let client: PrismaClient;
  if (d1) {
    client = createD1PrismaClientSync(d1);
  } else if (!isPlainNodeRuntime()) {
    throw new Error(
      'No D1 binding `DB` in this runtime. Use getDb() inside a request so getCloudflareContext can bind env.DB.'
    );
  } else {
    ensureLocalDatabaseUrl();
    client = createFileSqlitePrismaClient(process.env.DATABASE_URL!.trim());
  }

  globalForPrisma.prisma = client;
  globalForPrisma.prismaD1 = wantD1;
  globalForPrisma.prismaD1Binding = d1;
  return client;
}

/**
 * Legacy singleton. On Workers, only safe after getDb() has warmed the cache,
 * or when ALS already holds D1. Prefer getDb() in auth routes.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export async function probeDatabaseConnection(): Promise<void> {
  await withDbConnectionRetry(
    async () => {
      const db = await getDb();
      await db.$queryRaw`SELECT 1`;
    },
    { context: 'health.database' }
  );
}

export function warmDatabaseConnectionInBackground(): void {
  void withDbConnectionRetry(
    async () => {
      const db = await getDb();
      await db.$queryRaw`SELECT 1`;
    },
    { context: 'startup.warmup', maxAttempts: 3 }
  ).catch((error) => {
    logger.warn('db.warmup_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
  });
}

export { isD1Runtime, isCloudflareWorkerRuntime };
