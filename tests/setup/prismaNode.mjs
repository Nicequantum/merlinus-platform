/**
 * Node/CI Prisma client factory for integration fixtures.
 *
 * Production Workers: `@prisma/adapter-d1` via src/lib/db.ts (binding DB).
 * Plain Node (npm test / test:integration): file SQLite with
 * `@prisma/adapter-better-sqlite3` because generator engineType=client always
 * requires a driver adapter on the WASM/client engine path used by getPrisma().
 *
 * Usage:
 *   import { createTestPrismaClient } from '../setup/prismaNode.mjs';
 *   const prisma = createTestPrismaClient();
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3';

const require = createRequire(import.meta.url);
const LOCAL_SQLITE_URL = 'file:./prisma/dev.db';

/**
 * Match Prisma CLI: relative file: URLs resolve against the schema directory (prisma/).
 * Repo convention file:./prisma/dev.db → prisma/prisma/dev.db (same as prisma db push).
 * @param {string} databaseUrl
 * @returns {string} absolute filesystem path for better-sqlite3
 */
export function resolveLocalSqliteFilePath(databaseUrl) {
  const stripped = (databaseUrl ?? '').trim().replace(/^file:/i, '');
  if (!stripped) {
    return path.resolve(process.cwd(), 'prisma', 'dev.db');
  }
  if (path.isAbsolute(stripped)) {
    return stripped;
  }
  return path.resolve(path.join(process.cwd(), 'prisma'), stripped);
}

/**
 * File-SQLite Prisma client for plain Node / CI.
 * @param {{ databaseUrl?: string }} [opts]
 * @returns {import('@prisma/client').PrismaClient}
 */
export function createNodePrismaClient(opts = {}) {
  const envUrl = (opts.databaseUrl ?? process.env.DATABASE_URL ?? LOCAL_SQLITE_URL).trim();
  if (!process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = envUrl.startsWith('file:') ? envUrl : `file:${envUrl}`;
  }
  const filePath = resolveLocalSqliteFilePath(process.env.DATABASE_URL);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const adapter = new PrismaBetterSQLite3({ url: filePath });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === '1' ? ['error', 'warn'] : ['error'],
  });
}

/**
 * Prisma client for a Cloudflare D1 binding (tests that inject __MERLIN_D1__ / DB).
 * @param {{ prepare: Function }} d1
 * @returns {import('@prisma/client').PrismaClient}
 */
export function createD1PrismaClient(d1) {
  const { PrismaD1 } = require('@prisma/adapter-d1');
  const adapter = new PrismaD1(d1);
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === '1' ? ['error', 'warn'] : ['error'],
  });
}

/**
 * Prefer D1 adapter when a binding is injected; otherwise file SQLite on Node.
 * @returns {import('@prisma/client').PrismaClient}
 */
export function createTestPrismaClient() {
  const d1 = globalThis.__MERLIN_D1__ ?? globalThis.DB;
  if (d1 && typeof d1.prepare === 'function') {
    return createD1PrismaClient(d1);
  }
  return createNodePrismaClient();
}
