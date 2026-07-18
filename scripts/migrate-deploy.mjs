#!/usr/bin/env node
/**
 * Database schema deploy for Cloudflare D1.
 *
 * Prisma migrate deploy is NOT used with D1. Schema SQL lives under ./migrations
 * and is applied with Wrangler:
 *   npx wrangler d1 migrations apply <database_name> --local|--remote
 *
 * This script:
 *  - Documents / optionally invokes wrangler when RUN_D1_MIGRATE=1
 *  - Never requires DATABASE_URL or DIRECT_URL
 *  - Optionally seeds accounts when SEED_ON_DEPLOY=1 and a local SQLite file is present
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const isVercel = process.env.VERCEL === '1';
const shouldRun =
  process.env.RUN_D1_MIGRATE === '1' ||
  process.env.RUN_MIGRATE_DEPLOY === '1' ||
  (process.env.CI === 'true' && process.env.RUN_D1_MIGRATE === '1');

const d1Name = process.env.D1_DATABASE_NAME?.trim() || 'merlinus-d1';
const remote = process.env.D1_MIGRATE_REMOTE === '1' || process.env.D1_MIGRATE_REMOTE === 'true';

if (!shouldRun) {
  console.log(
    '[merlin:migrate] Skipping D1 migrate (set RUN_D1_MIGRATE=1 to apply wrangler d1 migrations)'
  );
  console.log(
    `[merlin:migrate] Manual: npx wrangler d1 migrations apply ${d1Name} ${remote ? '--remote' : '--local'}`
  );
  process.exit(0);
}

if (!existsSync('wrangler.toml') && !existsSync('wrangler.jsonc')) {
  console.error('[merlin:migrate] wrangler.toml / wrangler.jsonc not found — cannot apply D1 migrations');
  process.exit(1);
}

const flag = remote ? '--remote' : '--local';
try {
  console.log(`[merlin:migrate] Applying D1 migrations: ${d1Name} ${flag}`);
  execSync(`npx wrangler d1 migrations apply ${d1Name} ${flag}`, {
    stdio: 'inherit',
    env: process.env,
  });
  console.log('[merlin:migrate] D1 migrations applied successfully');
} catch (error) {
  console.error('[merlin:migrate] D1 migration apply failed');
  process.exit(typeof error?.status === 'number' ? error.status : 1);
}

if (process.env.SEED_ON_DEPLOY === '1') {
  try {
    // Seed uses local Prisma client (file SQLite or injected D1) — optional post-migrate.
    if (!process.env.DATABASE_URL?.trim()) {
      process.env.DATABASE_URL = 'file:./prisma/dev.db';
    }
    console.log('[merlin:migrate] SEED_ON_DEPLOY=1 — running npm run db:seed…');
    execSync('npm run db:seed', { stdio: 'inherit', env: process.env });
    console.log('[merlin:migrate] Seed accounts verified');
  } catch (error) {
    console.error('[merlin:migrate] Seed failed');
    process.exit(typeof error?.status === 'number' ? error.status : 1);
  }
}

if (isVercel && !shouldRun) {
  // unreachable — kept for clarity
}
