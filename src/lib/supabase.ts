import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  getSupabaseEnvConfig,
  isSupabaseConfigured,
  isSupabaseServiceConfigured,
} from '@/lib/supabaseEnv';
import { logger } from '@/lib/logger';

let serviceClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

function createServiceClient(): SupabaseClient | null {
  if (!isSupabaseServiceConfigured()) return null;
  const { url, serviceRoleKey } = getSupabaseEnvConfig();
  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function createAnonClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  const { url, anonKey } = getSupabaseEnvConfig();
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * APEX NATIONAL PLATFORM — server-side Supabase admin client (service role).
 * MERLINUS SINGLE-DEALER: returns null when Supabase is not configured.
 */
export function getSupabaseServiceClient(): SupabaseClient | null {
  if (!isSupabaseServiceConfigured()) return null;
  if (!serviceClient) {
    serviceClient = createServiceClient();
  }
  return serviceClient;
}

/**
 * APEX NATIONAL PLATFORM — server-side anon client (RLS-respecting reads in future phases).
 * MERLINUS SINGLE-DEALER: returns null when Supabase is not configured.
 */
export function getSupabaseAnonClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!anonClient) {
    anonClient = createAnonClient();
  }
  return anonClient;
}

export interface SupabaseConnectionProbe {
  ok: boolean;
  backend: 'service' | 'anon';
  latencyMs?: number;
  detail?: string;
}

/** Lightweight REST probe — confirms API keys reach the live Supabase project. */
export async function probeSupabaseConnection(
  backend: 'service' | 'anon' = 'service'
): Promise<SupabaseConnectionProbe> {
  const client =
    backend === 'service' ? getSupabaseServiceClient() : getSupabaseAnonClient();
  if (!client) {
    return {
      ok: false,
      backend,
      detail: 'Supabase client not configured',
    };
  }

  const start = Date.now();
  try {
    const { error } = await client.from('Dealer').select('id', { head: true, count: 'exact' });
    const latencyMs = Date.now() - start;

    // PGRST205 = table not in schema cache yet (pre-migration) — API key still valid.
    if (error && error.code !== 'PGRST205') {
      return {
        ok: false,
        backend,
        latencyMs,
        detail: error.message,
      };
    }

    return { ok: true, backend, latencyMs };
  } catch (error) {
    return {
      ok: false,
      backend,
      latencyMs: Date.now() - start,
      detail: error instanceof Error ? error.message : 'probe failed',
    };
  }
}

/** Reset cached clients (tests or hot reload). */
export function resetSupabaseClients(): void {
  serviceClient = null;
  anonClient = null;
}

/** Log Supabase readiness once per process in production. */
export function logSupabaseProductionReadiness(): void {
  const config = getSupabaseEnvConfig();
  if (!config.url) return;

  logger.info('supabase.config', {
    projectRef: config.projectRef,
    apiConfigured: config.isConfigured,
    serviceConfigured: config.isServiceConfigured,
    postgresConfigured: config.isPostgresConfigured,
  });
}