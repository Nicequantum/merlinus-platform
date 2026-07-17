/**
 * APEX NATIONAL PLATFORM — Prisma/Postgres connection resolution (Phase 1.5).
 * MERLINUS SINGLE-DEALER: when Apex Supabase Postgres is not configured, DATABASE_URL is unchanged.
 */

import { isApexEnvEnabled, loadApexEnvFile } from '@/lib/apex/loadApexEnv';

// Load .env.apex.local before reading any Apex/Supabase env vars.
loadApexEnvFile();

export type DatabaseBackend = 'merlinus_legacy' | 'apex_supabase';

export interface ResolvedDatabaseConfig {
  backend: DatabaseBackend;
  databaseUrl: string | null;
  directUrl: string | null;
  supabaseProjectRef: string | null;
}

function trimEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value || null;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/** Extract project ref from https://<ref>.supabase.co */
export function extractSupabaseProjectRef(supabaseUrl: string): string | null {
  try {
    const host = new URL(supabaseUrl).hostname;
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Build Supabase pooler URLs from project ref + database password (dashboard → Database). */
export function buildSupabasePostgresUrls(input: {
  projectRef: string;
  password: string;
  region?: string;
}): { databaseUrl: string; directUrl: string } {
  const region = input.region?.trim() || trimEnv('SUPABASE_DB_REGION') || 'us-east-1';
  const encodedPassword = encodeURIComponent(input.password);
  const host = `aws-0-${region}.pooler.supabase.com`;
  const user = `postgres.${input.projectRef}`;

  return {
    databaseUrl: `postgresql://${user}:${encodedPassword}@${host}:6543/postgres?pgbouncer=true&connection_limit=1`,
    directUrl: `postgresql://${user}:${encodedPassword}@${host}:5432/postgres`,
  };
}

function resolveApexPostgresUrls(): { databaseUrl: string | null; directUrl: string | null } {
  const explicitDatabaseUrl =
    trimEnv('SUPABASE_DATABASE_URL') || trimEnv('APEX_DATABASE_URL');
  const explicitDirectUrl =
    trimEnv('SUPABASE_DIRECT_DATABASE_URL') || trimEnv('APEX_DIRECT_DATABASE_URL');

  if (explicitDatabaseUrl) {
    return {
      databaseUrl: explicitDatabaseUrl,
      directUrl: explicitDirectUrl || explicitDatabaseUrl,
    };
  }

  const password = trimEnv('SUPABASE_DB_PASSWORD') || trimEnv('APEX_DB_PASSWORD');
  const supabaseUrl = trimEnv('NEXT_PUBLIC_SUPABASE_URL');
  const projectRef = supabaseUrl ? extractSupabaseProjectRef(supabaseUrl) : trimEnv('SUPABASE_PROJECT_REF');

  if (!password || !projectRef) {
    return { databaseUrl: null, directUrl: null };
  }

  const built = buildSupabasePostgresUrls({ projectRef, password });
  return built;
}

/** True when Apex can route Prisma to live Supabase Postgres (URL or password + project ref). */
export function isApexSupabasePostgresConfigured(): boolean {
  return resolveApexPostgresUrls().databaseUrl !== null;
}

/** True when we should prefer Supabase Postgres over legacy DATABASE_URL. */
export function shouldUseApexSupabaseDatabase(): boolean {
  if (!isApexSupabasePostgresConfigured()) return false;
  if (isTruthyEnv(process.env.APEX_USE_SUPABASE_DB)) return true;
  if (isApexEnvEnabled()) return true;

  // National Apex UI must hit Supabase owners DB — not Merlinus DATABASE_URL (db.prisma.io).
  const platformMode =
    process.env.PLATFORM_MODE?.trim().toLowerCase() ||
    process.env.NEXT_PUBLIC_PLATFORM_MODE?.trim().toLowerCase();
  if (platformMode === 'apex') return true;

  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const supabaseUrl = trimEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = trimEnv('SUPABASE_SERVICE_ROLE_KEY');

  // APEX NATIONAL PLATFORM — auto-select Supabase Postgres in production when fully configured.
  return Boolean(isProduction && supabaseUrl && serviceKey);
}

export function resolveDatabaseConfig(): ResolvedDatabaseConfig {
  const legacyDatabaseUrl = trimEnv('DATABASE_URL');
  const legacyDirectUrl = trimEnv('DIRECT_URL') || legacyDatabaseUrl;
  const supabaseUrl = trimEnv('NEXT_PUBLIC_SUPABASE_URL');
  const projectRef = supabaseUrl ? extractSupabaseProjectRef(supabaseUrl) : null;

  if (shouldUseApexSupabaseDatabase()) {
    const apex = resolveApexPostgresUrls();
    if (apex.databaseUrl) {
      return {
        backend: 'apex_supabase',
        databaseUrl: apex.databaseUrl,
        directUrl: apex.directUrl || apex.databaseUrl,
        supabaseProjectRef: projectRef,
      };
    }
  }

  // MERLINUS SINGLE-DEALER — existing DATABASE_URL/DIRECT_URL behavior.
  return {
    backend: 'merlinus_legacy',
    databaseUrl: legacyDatabaseUrl,
    directUrl: legacyDirectUrl,
    supabaseProjectRef: null,
  };
}

/**
 * Apply resolved Apex database URLs to process.env before Prisma client initialization.
 * Safe to call multiple times; only mutates env when Apex Supabase Postgres is active.
 */
export function applyResolvedDatabaseEnv(): ResolvedDatabaseConfig {
  const config = resolveDatabaseConfig();
  if (config.backend === 'apex_supabase' && config.databaseUrl) {
    process.env.DATABASE_URL = config.databaseUrl;
    if (config.directUrl) {
      process.env.DIRECT_URL = config.directUrl;
    }
  }
  return config;
}

/** Non-secret summary for logs and health endpoints. */
export function getDatabaseBackendSummary(): {
  backend: DatabaseBackend;
  supabaseProjectRef: string | null;
} {
  const config = resolveDatabaseConfig();
  return {
    backend: config.backend,
    supabaseProjectRef: config.supabaseProjectRef,
  };
}