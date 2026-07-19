import 'server-only';
// engineType=client (schema.prisma): always requires a driver adapter — no native query engine.
// Workers: PrismaD1(env.DB). Plain Node/CI: PrismaBetterSQLite3(file SQLite).
// Default @prisma/client (not /wasm) — OpenNext patches this package for workerd.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import {
  getD1Database,
  isCloudflareWorkerRuntime,
  isD1Runtime,
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
 */
export function resolveLocalSqliteFilePath(databaseUrl: string): string {
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

/**
 * Local/CI file SQLite adapter for plain Node.
 * Dynamic require keeps native better-sqlite3 out of the Workers/OpenNext bundle.
 */
function createFileSqlitePrismaClient(databaseUrl: string): PrismaClient {
  // Dynamic require keeps native better-sqlite3 out of the Workers/OpenNext graph.
  // eslint-disable-next-line -- require() is intentional for optional Node-only native dep
  const { PrismaBetterSQLite3 } = require('@prisma/adapter-better-sqlite3') as typeof import('@prisma/adapter-better-sqlite3');
  const filePath = resolveLocalSqliteFilePath(databaseUrl);
  // Ensure parent directory exists so first open does not throw ENOENT on missing dirs.
  mkdirSync(path.dirname(filePath), { recursive: true });
  // Factory adapter (engineType=client) — PrismaClient calls connect() internally.
  // Pass absolute path (no file: prefix) so better-sqlite3 opens the Prisma CLI DB file.
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
    logger.info('db.backend', { backend: 'cloudflare_d1', binding: 'DB' });
    const adapter = new PrismaD1(d1 as ConstructorParameters<typeof PrismaD1>[0]);
    return new PrismaClient({
      adapter,
      log: prismaLogLevel(),
    });
  }

  if (isCloudflareWorkerRuntime()) {
    // Falling back to file SQLite on Workers causes blank pages / cryptic crashes.
    throw new Error(
      'Cloudflare Worker runtime has no D1 binding `DB`. Check wrangler.toml [[d1_databases]] binding = "DB" and redeploy.'
    );
  }

  ensureLocalDatabaseUrl();
  const databaseUrl = process.env.DATABASE_URL!.trim();
  // engineType=client: WASM client cannot run without a driver adapter on Node either.
  return createFileSqlitePrismaClient(databaseUrl);
}
/**
 * Resolve Prisma client (D1 on Cloudflare, file SQLite locally).
 * Prefer getPrisma() in request paths so OpenNext can attach env.DB after cold start.
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
      await getPrisma().$queryRaw`SELECT 1`;
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
      await getPrisma().$queryRaw`SELECT 1`;
    },
    { context: 'startup.warmup', maxAttempts: 3 }
  ).catch((error) => {
    logger.warn('db.warmup_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
  });
}

export { isD1Runtime, isCloudflareWorkerRuntime };
