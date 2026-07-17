#!/usr/bin/env node
/**
 * APEX NATIONAL PLATFORM — deploy Prisma migrations to live Supabase Postgres.
 * Usage: npm run db:migrate:apex
 *
 * Requires .env.apex.local (or env) with Supabase API keys + Postgres connection vars.
 * Sets APEX_USE_SUPABASE_DB=true for the duration of this command.
 */
import { execSync } from 'node:child_process';
import { applyApexDatabaseEnv } from './resolve-apex-database-env.mjs';

process.env.APEX_ENV = '1';
process.env.APEX_USE_SUPABASE_DB = 'true';

const result = applyApexDatabaseEnv();
if (!result.applied || result.backend !== 'apex_supabase') {
  console.error('[merlin:apex-migrate] Apex Supabase Postgres is not configured.');
  console.error(
    '[merlin:apex-migrate] Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and either:'
  );
  console.error('  - SUPABASE_DATABASE_URL (+ optional SUPABASE_DIRECT_DATABASE_URL), or');
  console.error('  - SUPABASE_DB_PASSWORD (with project ref from NEXT_PUBLIC_SUPABASE_URL)');
  process.exit(1);
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error('[merlin:apex-migrate] DATABASE_URL could not be resolved for Supabase.');
  process.exit(1);
}

if (!process.env.DIRECT_URL?.trim()) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

console.log('[merlin:apex-migrate] Applying migrations to Apex Supabase Postgres...');

try {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
  console.log('[merlin:apex-migrate] Migrations applied successfully');
} catch (error) {
  console.error('[merlin:apex-migrate] Migration deploy failed');
  process.exit(typeof error.status === 'number' ? error.status : 1);
}