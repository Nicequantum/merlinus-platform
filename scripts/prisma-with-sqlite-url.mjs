#!/usr/bin/env node
/**
 * Run a Prisma CLI command with a guaranteed sqlite file: DATABASE_URL.
 *
 * Cloudflare D1 is the production database (PrismaD1 + binding DB).
 * Prisma CLI still needs a file: URL for generate / db push / studio.
 *
 * Usage:
 *   node scripts/prisma-with-sqlite-url.mjs generate
 *   node scripts/prisma-with-sqlite-url.mjs db push --accept-data-loss
 *
 * Rejects `prisma migrate deploy` — use wrangler d1 migrations instead.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/prisma-with-sqlite-url.mjs <prisma-args...>');
  process.exit(1);
}

const joined = args.join(' ');
if (/\bmigrate\s+deploy\b/.test(joined) || args.includes('migrate') && args.includes('deploy')) {
  console.error('[merlin:prisma] `prisma migrate deploy` is not used with Cloudflare D1.');
  console.error('[merlin:prisma] Apply schema with:');
  console.error('  npx wrangler d1 migrations apply merlinus-d1 --local|--remote');
  console.error('  # or for local file SQLite CI: npx prisma db push');
  process.exit(1);
}

const LOCAL = 'file:./prisma/dev.db';
const current = process.env.DATABASE_URL?.trim() || '';
if (!current.startsWith('file:')) {
  if (current && /^postgres(ql)?:\/\//i.test(current)) {
    console.warn(
      `[merlin:prisma] Ignoring PostgreSQL DATABASE_URL for Prisma CLI — using ${LOCAL}`
    );
  }
  process.env.DATABASE_URL = LOCAL;
}

const result = spawnSync('npx', ['prisma', ...args], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});
process.exit(result.status ?? 1);
