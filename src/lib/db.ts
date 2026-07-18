import 'server-only';
// Prefer WASM / workerd client so Workers never load the Node query engine
// (which calls fs.readdir and throws under unenv). Falls back to default for local Node.
import { PrismaClient } from '@prisma/client/wasm';
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

function createPrismaClient(d1: D1DatabaseLike | null): PrismaClient {
  if (d1) {
    logger.info('db.backend', { backend: 'cloudflare_d1', binding: 'DB' });
    const adapter = new PrismaD1(d1 as ConstructorParameters<typeof PrismaD1>[0]);
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }

  if (isCloudflareWorkerRuntime()) {
    // Falling back to file SQLite on Workers causes blank pages / cryptic crashes.
    throw new Error(
      'Cloudflare Worker runtime has no D1 binding `DB`. Check wrangler.toml [[d1_databases]] binding = "DB" and redeploy.'
    );
  }

  ensureLocalDatabaseUrl();
  if (process.env.NODE_ENV === 'development') {
    logger.info('db.backend', {
      backend: 'sqlite_file',
      url: process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL : 'file:***',
    });
  }
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
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
