import 'server-only';
import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import { getD1Database, isD1Runtime } from '@/lib/d1';
import { logger } from './logger';
import { withDbConnectionRetry } from './dbRetry';

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  prismaD1?: boolean;
};

/**
 * Default local SQLite URL for prisma generate / Node without D1.
 * D1 runtime ignores this when adapter is passed to PrismaClient.
 */
export const LOCAL_SQLITE_URL = 'file:./prisma/dev.db';

function ensureLocalDatabaseUrl(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = LOCAL_SQLITE_URL;
  }
}

function createPrismaClient(): PrismaClient {
  const d1 = getD1Database();
  if (d1) {
    logger.info('db.backend', { backend: 'cloudflare_d1', binding: 'DB' });
    // PrismaD1 expects the Workers D1Database type; our helper validates .prepare().
    const adapter = new PrismaD1(d1 as ConstructorParameters<typeof PrismaD1>[0]);
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
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
 * Singleton Prisma client.
 * - Cloudflare: PrismaD1(env.DB) adapter (binding name `DB`)
 * - Local/CI: native SQLite via DATABASE_URL (default file:./prisma/dev.db)
 *
 * Note: if the process later gains a D1 binding (unlikely in same isolate),
 * restart is required to switch engines.
 */
export const prisma =
  globalForPrisma.prisma && globalForPrisma.prismaD1 === isD1Runtime()
    ? globalForPrisma.prisma
    : createPrismaClient();

globalForPrisma.prisma = prisma;
globalForPrisma.prismaD1 = isD1Runtime();

/** Health-check probe with connection retry — not used on request hot paths. */
export async function probeDatabaseConnection(): Promise<void> {
  await withDbConnectionRetry(
    async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    { context: 'health.database' }
  );
}

/** Background cold-start warmup; never blocks login or RO scan handlers. */
export function warmDatabaseConnectionInBackground(): void {
  void withDbConnectionRetry(
    async () => {
      await prisma.$connect();
    },
    { context: 'startup.warmup', maxAttempts: 3 }
  ).catch((error) => {
    logger.warn('db.warmup_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
  });
}
