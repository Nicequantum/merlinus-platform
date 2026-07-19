/**
 * Database backend resolution — Cloudflare D1 only.
 *
 * Runtime: PrismaD1(env.DB) via src/lib/db.ts + src/lib/d1.ts.
 * Local tooling: DATABASE_URL=file:./prisma/dev.db for prisma generate / optional file SQLite.
 */

import { loadApexEnvFile } from '@/lib/apex/loadApexEnv';
import { isD1Runtime } from '@/lib/d1';

// Load .env.apex.local for non-DB Apex secrets when present.
loadApexEnvFile();

export type DatabaseBackend = 'cloudflare_d1' | 'sqlite_file';

export interface ResolvedDatabaseConfig {
  backend: DatabaseBackend;
  /** Local file URL for prisma generate / Node fallback — never a Postgres URL. */
  databaseUrl: string | null;
  /** @deprecated D1 has no directUrl; always null. */
  directUrl: string | null;
  /** @deprecated Postgres Supabase ref unused for Prisma. */
  supabaseProjectRef: string | null;
}

const LOCAL_SQLITE = 'file:./prisma/dev.db';

function trimEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value || null;
}

/** @deprecated Supabase Postgres is no longer used for Prisma — kept for call-site compatibility. */
export function extractSupabaseProjectRef(supabaseUrl: string): string | null {
  try {
    const host = new URL(supabaseUrl).hostname;
    const match = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** @deprecated Always returns false — D1 is the sole database. */
export function isApexSupabasePostgresConfigured(): boolean {
  return false;
}

/** @deprecated Always returns false — D1 is the sole database. */
export function shouldUseApexSupabaseDatabase(): boolean {
  return false;
}

/** @deprecated No-op builder retained so older scripts import cleanly. */
export function buildSupabasePostgresUrls(_input: {
  projectRef: string;
  password: string;
  region?: string;
}): { databaseUrl: string; directUrl: string } {
  throw new Error(
    'PostgreSQL/Supabase is no longer supported. Merlinus uses Cloudflare D1 (binding DB).'
  );
}

export function resolveDatabaseConfig(): ResolvedDatabaseConfig {
  let rawUrl = trimEnv('DATABASE_URL');

  // Stale Postgres URLs (legacy Vercel/Supabase or .env.local baked into OpenNext)
  // must never crash the Worker — D1 uses binding DB, not DATABASE_URL.
  if (rawUrl && /^postgres(ql)?:\/\//i.test(rawUrl)) {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(
        '[merlin:db] Ignoring PostgreSQL DATABASE_URL — Merlinus uses Cloudflare D1 (binding DB).'
      );
    }
    rawUrl = null;
  }

  if (isD1Runtime()) {
    return {
      backend: 'cloudflare_d1',
      databaseUrl: rawUrl || LOCAL_SQLITE,
      directUrl: null,
      supabaseProjectRef: null,
    };
  }

  return {
    backend: 'sqlite_file',
    databaseUrl: rawUrl || LOCAL_SQLITE,
    directUrl: null,
    supabaseProjectRef: null,
  };
}

/**
 * Ensure a non-Postgres DATABASE_URL exists for prisma generate / local file engine.
 * Does not configure D1 (that uses the env.DB binding).
 */
export function applyResolvedDatabaseEnv(): ResolvedDatabaseConfig {
  const config = resolveDatabaseConfig();
  const current = process.env.DATABASE_URL?.trim();
  // Strip postgres URLs that would poison Prisma or crash earlier validation paths.
  if (!current || /^postgres(ql)?:\/\//i.test(current)) {
    process.env.DATABASE_URL = config.databaseUrl || LOCAL_SQLITE;
  }
  // Never set DIRECT_URL for D1.
  delete process.env.DIRECT_URL;
  return config;
}

/** Non-secret summary for logs and health endpoints. */
export function getDatabaseBackendSummary(): {
  backend: DatabaseBackend;
  supabaseProjectRef: string | null;
  d1Binding: 'DB';
} {
  const config = resolveDatabaseConfig();
  return {
    backend: config.backend,
    supabaseProjectRef: null,
    d1Binding: 'DB',
  };
}
