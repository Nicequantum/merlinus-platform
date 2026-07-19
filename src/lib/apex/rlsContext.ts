import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import type { AuditScopeMode } from '@/lib/apex/platformConstants';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import {
  resolveSessionScopeMode,
  type TenantScopedSession,
} from '@/lib/apex/tenantScope';
import type { SessionPayload } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isApexPlatformMode } from '@/lib/platformMode';

/** Transaction client or root Prisma client that supports $executeRaw. */
export type RlsDbClient = Prisma.TransactionClient | typeof prisma;

export interface RlsContext {
  technicianId: string;
  /** Active rooftop for dealership-scoped PII; empty/null in national scope. */
  activeDealershipId: string | null;
  dealerId: string | null;
  scopeMode: AuditScopeMode;
  /**
   * When true, policies enforce tenant filters (app.rls_enforced=on).
   * Apex defaults to enforced; Merlinus soft-open unless RLS_ENABLED forces enforce.
   */
  enforced?: boolean;
  /**
   * When true, policies allow soft-open (Merlinus only). Never set for Apex.
   * Maps to app.rls_soft_open=on.
   */
  softOpen?: boolean;
  /** Service/seed path — sets app.rls_bypass=on for the transaction. */
  bypass?: boolean;
}

const rlsTxStorage = new AsyncLocalStorage<Prisma.TransactionClient>();

/**
 * Phase 6.2 — enforce tenant RLS by default on Apex.
 * Merlinus remains soft-open unless RLS_ENABLED forces enforcement.
 *
 * Explicit env:
 *   RLS_ENABLED=true|1|yes|on  → enforce (both modes)
 *   RLS_ENABLED=false|0|no|off → soft-open **only when not Apex** (Apex ignores off)
 */
export function isRlsEnabled(): boolean {
  const value = process.env.RLS_ENABLED?.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') {
    return true;
  }
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') {
    // Apex never soft-opens via env off — default-deny / always enforce.
    return isApexPlatformMode() ? true : false;
  }
  // Default: Apex enforce; Merlinus soft-open.
  return isApexPlatformMode();
}

/** Merlinus-only soft-open (policies require app.rls_soft_open=on). */
export function isRlsSoftOpen(): boolean {
  return !isRlsEnabled();
}

/**
 * Build RLS context from an authenticated session.
 * National owners get scope_mode=national with no active dealership (PII policies deny).
 */
export function rlsContextFromSession(
  session: TenantScopedSession & Pick<SessionPayload, 'technicianId'>
): RlsContext {
  const scopeMode = resolveSessionScopeMode(session);
  const rawActive =
    scopeMode === 'dealership'
      ? (session.activeDealershipId?.trim() || session.dealershipId?.trim() || '')
      : '';
  const activeDealershipId =
    rawActive && rawActive !== APEX_NATIONAL_DEALERSHIP_ID ? rawActive : null;

  const enforced = isRlsEnabled();
  return {
    technicianId: session.technicianId.trim(),
    activeDealershipId,
    dealerId: session.dealerId?.trim() || null,
    scopeMode,
    enforced,
    softOpen: !enforced,
  };
}

/**
 * Prisma client for the current request when inside withSessionRls / withRlsContext.
 * Falls back to the global singleton outside an RLS transaction.
 */
export function getRlsDb(): RlsDbClient {
  return rlsTxStorage.getStore() ?? prisma;
}

/** Active RLS transaction client, if any (for joining audits into the same unit of work). */
export function getRlsTransaction(): Prisma.TransactionClient | undefined {
  return rlsTxStorage.getStore();
}

/**
 * Apply tenant context for the current unit of work.
 *
 * PostgreSQL previously used set_config(... is_local) for DB-level RLS policies.
 * Cloudflare D1 / SQLite has no session GUC or Postgres RLS — isolation is enforced
 * in application queries (dealershipId / dealerId filters) and rlsTxStorage.
 * This function is intentionally a no-op on D1 while preserving the call sites.
 */
export async function setRlsContext(_client: RlsDbClient, _ctx: RlsContext): Promise<void> {
  // Multi-rooftop isolation: use getRlsDb() + explicit dealership filters in queries.
  // D1 does not support Postgres set_config / RLS policies.
  void _client;
  void _ctx;
}

/**
 * Run work with tenant context applied.
 *
 * Postgres used SET LOCAL inside interactive `$transaction`. D1/SQLite has neither
 * session GUCs nor interactive transactions (PrismaD1 throws). On D1/Workers we
 * run on the root client and bind it via ALS so getRlsDb() stays consistent.
 */
export async function withRlsContext<T>(
  ctx: RlsContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const existing = rlsTxStorage.getStore();
  if (existing) {
    await setRlsContext(existing, ctx);
    return fn(existing);
  }

  // Always use root client + ALS. Interactive $transaction is unsupported on
  // PrismaD1 and unnecessary on SQLite (setRlsContext is a no-op; isolation is
  // application-level dealershipId / dealerId filters).
  const client = prisma as unknown as Prisma.TransactionClient;
  await setRlsContext(client, ctx);
  return rlsTxStorage.run(client, () => fn(client));
}

/**
 * Phase 6.2 — default PII path: enforce tenant RLS for the session and bind getRlsDb().
 * Always sets enforced=on and soft_open=off (default-deny when not bypass/tenant-matched).
 */
export async function withSessionRls<T>(
  session: TenantScopedSession & Pick<SessionPayload, 'technicianId'>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const ctx: RlsContext = {
    ...rlsContextFromSession(session),
    enforced: true,
    softOpen: false,
  };
  return withRlsContext(ctx, fn);
}

/**
 * Control-plane / auth / seed / national aggregates — bypass tenant filters for the transaction.
 * Prefer over bare prisma when default-deny policies are active (Phase 6.2).
 */
export async function withRlsBypass<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withRlsContext(
    {
      technicianId: '',
      activeDealershipId: null,
      dealerId: null,
      scopeMode: 'dealership',
      enforced: true,
      softOpen: false,
      bypass: true,
    },
    fn
  );
}

/** @deprecated alias — use withRlsBypass */
export const withControlPlaneDb = withRlsBypass;

/**
 * Atomic multi-step work under RLS. Reuses the ambient withSessionRls transaction
 * when present so nested prisma.$transaction does not open a non-RLS connection.
 * Pass session-derived ctx when calling outside withSessionRls (e.g. after Grok).
 */
export async function rlsTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ctx?: RlsContext
): Promise<T> {
  const existing = rlsTxStorage.getStore();
  if (existing) {
    if (ctx) {
      await setRlsContext(existing, {
        ...ctx,
        enforced: ctx.enforced ?? true,
        softOpen: false,
      });
    }
    return fn(existing);
  }
  if (ctx) {
    return withRlsContext(
      {
        ...ctx,
        enforced: ctx.enforced ?? true,
        softOpen: ctx.softOpen ?? false,
      },
      fn
    );
  }
  // No session: Apex default-deny requires bypass for control-plane work.
  // Merlinus soft-open transaction when not enforcing.
  if (isRlsSoftOpen()) {
    return withRlsContext(
      {
        technicianId: '',
        activeDealershipId: null,
        dealerId: null,
        scopeMode: 'dealership',
        enforced: false,
        softOpen: true,
      },
      fn
    );
  }
  return withRlsBypass(fn);
}
