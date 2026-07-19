import 'server-only';
/**
 * Prisma client for Merlinus / Apex.
 *
 * Cloudflare Workers (login + API): PrismaD1(env.DB) only — never open a local
 * SQLite file or touch node:fs (unenv throws fs.readdir / mkdirSync).
 * Plain Node / CI: @prisma/adapter-better-sqlite3 with file: DATABASE_URL.
 */
import { PrismaClient } from '@prisma/client';
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

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  prismaD1?: boolean;
  /** Weak-map style: recreate client if D1 binding instance changes. */
  prismaD1Binding?: D1DatabaseLike | null;
};

/**
 * Default local SQLite URL for prisma generate / Node without D1.
 * Never used on Cloudflare Workers (file engine is unavailable there).
 */
export const LOCAL_SQLITE_URL = 'file:./prisma/dev.db';

function ensureLocalDatabaseUrl(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = LOCAL_SQLITE_URL;
  }
}

function prismaLogLevel(): Array<'error' | 'warn'> {
  return process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'];
}

/**
 * Prisma CLI resolves relative `file:` URLs against the schema directory (`prisma/`).
 * Repo convention `file:./prisma/dev.db` therefore lands at `prisma/prisma/dev.db`
 * for both `prisma db push` and the better-sqlite3 adapter — keep them aligned.
 *
 * Node-only — must not run (or pull path/fs) on Workers.
 */
export function resolveLocalSqliteFilePath(databaseUrl: string): string {
  // Dynamic require keeps node:path out of the Workers/OpenNext graph.
  // eslint-disable-next-line -- require() intentional for Node-only path resolution
  const path = require('node:path') as typeof import('node:path');
  const stripped = databaseUrl.trim().replace(/^file:/i, '');
  if (!stripped) {
    return path.resolve(process.cwd(), 'prisma', 'dev.db');
  }
  if (path.isAbsolute(stripped)) {
    return stripped;
  }
  const schemaDir = path.join(process.cwd(), 'prisma');
  return path.resolve(schemaDir, stripped);
}

function createD1PrismaClient(d1: D1DatabaseLike): PrismaClient {
  logger.info('db.backend', { backend: 'cloudflare_d1', binding: 'DB' });
  const adapter = new PrismaD1(d1 as ConstructorParameters<typeof PrismaD1>[0]);
  return new PrismaClient({
    adapter,
    log: prismaLogLevel(),
  });
}

/**
 * Local/CI file SQLite adapter for plain Node.
 * Dynamic require keeps native better-sqlite3 and node:fs out of the Workers bundle.
 */
function createFileSqlitePrismaClient(databaseUrl: string): PrismaClient {
  // eslint-disable-next-line -- require() is intentional for optional Node-only native deps
  const { mkdirSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line -- require() is intentional for optional Node-only native deps
  const path = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line -- require() is intentional for optional Node-only native dep
  const { PrismaBetterSQLite3 } = require('@prisma/adapter-better-sqlite3') as typeof import('@prisma/adapter-better-sqlite3');
  const filePath = resolveLocalSqliteFilePath(databaseUrl);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const adapter = new PrismaBetterSQLite3({ url: filePath });
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    logger.info('db.backend', {
      backend: 'sqlite_file_adapter',
      path: filePath.endsWith('dev.db') ? filePath : '***',
    });
  }
  return new PrismaClient({
    adapter,
    log: prismaLogLevel(),
  });
}

function createPrismaClient(d1: D1DatabaseLike | null): PrismaClient {
  if (d1) {
    return createD1PrismaClient(d1);
  }

  if (isCloudflareWorkerRuntime()) {
    // Never open file SQLite on Workers — unenv has no real fs.readdir/mkdir.
    throw new Error(
      'Cloudflare Worker runtime has no D1 binding `DB`. Check wrangler.toml [[d1_databases]] binding = "DB" and redeploy.'
    );
  }

  ensureLocalDatabaseUrl();
  return createFileSqlitePrismaClient(process.env.DATABASE_URL!.trim());
}

/**
 * Resolve D1 via OpenNext getCloudflareContext (async) then fall back to getD1Database().
 * Call from request handlers (login, withAuth) so env.DB is request-scoped.
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
 * Async Prisma client for Cloudflare request paths (login, API).
 * Always uses PrismaD1(env.DB) when the binding is available — no filesystem.
 */
export async function getDb(): Promise<PrismaClient> {
  const d1 = await resolveD1Database();
  if (d1) {
    const existing = globalForPrisma.prisma;
    if (existing && globalForPrisma.prismaD1 && globalForPrisma.prismaD1Binding === d1) {
      return existing;
    }
    const client = createD1PrismaClient(d1);
    globalForPrisma.prisma = client;
    globalForPrisma.prismaD1 = true;
    globalForPrisma.prismaD1Binding = d1;
    return client;
  }

  // Sync path for Node/CI (or throw on Workers without DB)
  return getPrisma();
}

/**
 * Resolve Prisma client (D1 on Cloudflare, file SQLite locally).
 * Prefer getDb() on request paths so OpenNext can attach env.DB after cold start.
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

  const client = createPrismaClient(d1);
  globalForPrisma.prisma = client;
  globalForPrisma.prismaD1 = wantD1;
  globalForPrisma.prismaD1Binding = d1;
  return client;
}

/**
 * Singleton accessor for existing call sites (`import { prisma } from '@/lib/db'`).
 * Uses a Proxy so each property access re-resolves D1 (important on Workers).
 * On Workers, prefer getDb() so getCloudflareContext({ async: true }) can bind env.DB.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/** Health-check probe with connection retry — not used on request hot paths. */
export async function probeDatabaseConnection(): Promise<void> {
  await withDbConnectionRetry(
    async () => {
      const db = await getDb();
      await db.$queryRaw`SELECT 1`;
    },
    { context: 'health.database' }
  );
}

/** Background cold-start warmup; never blocks login or RO scan handlers. */
export function warmDatabaseConnectionInBackground(): void {
  void withDbConnectionRetry(
    async () => {
      // Prefer a real query over $connect(): on Workers/unenv, $connect can touch
      // fs APIs that are not implemented, while D1 SELECT 1 validates the binding.
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
