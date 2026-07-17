#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` during Vercel builds so production schema stays current.
 * Falls back DIRECT_URL to DATABASE_URL when a dedicated direct connection is not configured.
 */
import { execSync } from 'node:child_process';
import { applyApexDatabaseEnv } from './resolve-apex-database-env.mjs';

const isVercel = process.env.VERCEL === '1';
const shouldMigrate =
  isVercel || process.env.RUN_MIGRATE_DEPLOY === '1' || process.env.CI === 'true';

if (!shouldMigrate) {
  console.log('[merlin:migrate] Skipping migrate deploy (not Vercel/CI)');
  process.exit(0);
}

// APEX NATIONAL PLATFORM — prefer Supabase Postgres in production when configured.
const apexDb = applyApexDatabaseEnv();
if (apexDb.applied) {
  console.log('[merlin:migrate] Using Apex Supabase Postgres (resolved DATABASE_URL)');
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error('[merlin:migrate] DATABASE_URL is required to run migrate deploy');
  process.exit(1);
}

if (!process.env.DIRECT_URL?.trim()) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  console.log('[merlin:migrate] DIRECT_URL not set — using DATABASE_URL for migrations');
}

try {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
  console.log('[merlin:migrate] Migrations applied successfully');

  console.log('[merlin:migrate] Ensuring canonical seed accounts (D7HARRIH / D7TECH001)...');
  execSync('npm run db:seed', {
    stdio: 'inherit',
    env: process.env,
  });
  console.log('[merlin:migrate] Seed accounts verified');
} catch (error) {
  console.error('[merlin:migrate] Migration deploy failed');
  process.exit(typeof error.status === 'number' ? error.status : 1);
}