#!/usr/bin/env node
/**
 * APEX NATIONAL PLATFORM — resolve Prisma DATABASE_URL/DIRECT_URL for Supabase Postgres.
 * MERLINUS SINGLE-DEALER: no-op when Apex Postgres vars are absent or APEX_USE_SUPABASE_DB is unset locally.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnvFile(filename) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function trimEnv(key) {
  const value = process.env[key]?.trim();
  return value || null;
}

function isTruthy(value) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function extractSupabaseProjectRef(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname;
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function buildSupabasePostgresUrls({ projectRef, password, region }) {
  const resolvedRegion = region?.trim() || trimEnv('SUPABASE_DB_REGION') || 'us-east-1';
  const encodedPassword = encodeURIComponent(password);
  const host = `aws-0-${resolvedRegion}.pooler.supabase.com`;
  const user = `postgres.${projectRef}`;
  return {
    databaseUrl: `postgresql://${user}:${encodedPassword}@${host}:6543/postgres?pgbouncer=true&connection_limit=1`,
    directUrl: `postgresql://${user}:${encodedPassword}@${host}:5432/postgres`,
  };
}

function resolveApexPostgresUrls() {
  const explicitDatabaseUrl = trimEnv('SUPABASE_DATABASE_URL') || trimEnv('APEX_DATABASE_URL');
  const explicitDirectUrl = trimEnv('SUPABASE_DIRECT_DATABASE_URL') || trimEnv('APEX_DIRECT_DATABASE_URL');
  if (explicitDatabaseUrl) {
    return {
      databaseUrl: explicitDatabaseUrl,
      directUrl: explicitDirectUrl || explicitDatabaseUrl,
    };
  }

  const password = trimEnv('SUPABASE_DB_PASSWORD') || trimEnv('APEX_DB_PASSWORD');
  const supabaseUrl = trimEnv('NEXT_PUBLIC_SUPABASE_URL');
  const projectRef = supabaseUrl ? extractSupabaseProjectRef(supabaseUrl) : trimEnv('SUPABASE_PROJECT_REF');
  if (!password || !projectRef) return { databaseUrl: null, directUrl: null };
  return buildSupabasePostgresUrls({ projectRef, password });
}

function isApexEnvEnabled() {
  const value = process.env.APEX_ENV?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function shouldUseApexSupabaseDatabase() {
  const apex = resolveApexPostgresUrls();
  if (!apex.databaseUrl) return false;
  if (isTruthy(process.env.APEX_USE_SUPABASE_DB)) return true;
  if (isApexEnvEnabled()) return true;

  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const supabaseUrl = trimEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = trimEnv('SUPABASE_SERVICE_ROLE_KEY');
  return Boolean(isProduction && supabaseUrl && serviceKey);
}

/** Load optional Apex env file, then apply Supabase Postgres URLs when active. */
export function applyApexDatabaseEnv(options = {}) {
  const shouldLoadApexFile = options.loadApexEnvFile !== false && (isApexEnvEnabled() || options.forceLoadApexEnvFile);
  if (shouldLoadApexFile) {
    loadDotEnvFile('.env.apex.local');
  }

  if (!shouldUseApexSupabaseDatabase()) {
    return { backend: 'merlinus_legacy', applied: false };
  }

  const apex = resolveApexPostgresUrls();
  if (!apex.databaseUrl) {
    return { backend: 'merlinus_legacy', applied: false };
  }

  process.env.DATABASE_URL = apex.databaseUrl;
  process.env.DIRECT_URL = apex.directUrl || apex.databaseUrl;
  return { backend: 'apex_supabase', applied: true };
}

const invokedDirectly = process.argv[1]?.includes('resolve-apex-database-env.mjs');
if (invokedDirectly) {
  const result = applyApexDatabaseEnv();
  console.log(`[merlin:apex-db] backend=${result.backend} applied=${result.applied}`);
}