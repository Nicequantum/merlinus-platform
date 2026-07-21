/**
 * P3-1 — Explicit isolation mode for ops / health / docs alignment.
 * D1 has no Postgres RLS; tenancy is application-layer only.
 */

export const TENANT_ISOLATION_MODE = 'application_layer_d1' as const;

export type TenantIsolationMode = typeof TENANT_ISOLATION_MODE | 'postgres_rls';

export function getTenantIsolationMode(): TenantIsolationMode {
  // Future: detect Postgres backend and return 'postgres_rls' when policies are live.
  return TENANT_ISOLATION_MODE;
}

export function describeTenantIsolation(): {
  mode: TenantIsolationMode;
  databaseEnforced: boolean;
  registry: string;
  docs: string;
} {
  const mode = getTenantIsolationMode();
  return {
    mode,
    databaseEnforced: mode === 'postgres_rls',
    registry: 'src/lib/apex/rlsTenantRegistry.ts',
    docs: 'docs/Multi-Tenant-Isolation.md',
  };
}
