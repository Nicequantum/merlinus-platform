/**
 * APEX NATIONAL PLATFORM — Supabase environment helpers (Phase 1.5).
 * MERLINUS SINGLE-DEALER: Supabase vars are optional; Prisma continues via DATABASE_URL.
 */

import {
  extractSupabaseProjectRef,
  isApexSupabasePostgresConfigured,
} from '@/lib/apex/databaseConfig';

export interface SupabaseEnvConfig {
  url: string | null;
  anonKey: string | null;
  serviceRoleKey: string | null;
  projectRef: string | null;
  databaseUrl: string | null;
  directDatabaseUrl: string | null;
  isConfigured: boolean;
  isServiceConfigured: boolean;
  isPostgresConfigured: boolean;
}

export function getSupabaseEnvConfig(): SupabaseEnvConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
  const databaseUrl =
    process.env.SUPABASE_DATABASE_URL?.trim() ||
    process.env.APEX_DATABASE_URL?.trim() ||
    null;
  const directDatabaseUrl =
    process.env.SUPABASE_DIRECT_DATABASE_URL?.trim() ||
    process.env.APEX_DIRECT_DATABASE_URL?.trim() ||
    null;

  return {
    url,
    anonKey,
    serviceRoleKey,
    projectRef: url ? extractSupabaseProjectRef(url) : null,
    databaseUrl,
    directDatabaseUrl,
    isConfigured: Boolean(url && anonKey),
    isServiceConfigured: Boolean(url && serviceRoleKey),
    isPostgresConfigured: isApexSupabasePostgresConfigured(),
  };
}

/** True when Apex national platform Supabase project vars are present. */
export function isSupabaseConfigured(): boolean {
  return getSupabaseEnvConfig().isConfigured;
}

/** Server-side admin client requires service role key — never expose to the browser. */
export function isSupabaseServiceConfigured(): boolean {
  return getSupabaseEnvConfig().isServiceConfigured;
}

/** True when Apex has API + Postgres connection material for production routing. */
export function isApexSupabaseProductionReady(): boolean {
  const config = getSupabaseEnvConfig();
  return config.isServiceConfigured && config.isPostgresConfigured;
}