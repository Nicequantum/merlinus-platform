import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AuditScopeMode } from '@/lib/apex/platformConstants';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { createRlsEnforcedClient } from '@/lib/apex/rlsPrismaExtension';
import {
  resolveSessionScopeMode,
  type TenantScopedSession,
} from '@/lib/apex/tenantScope';
import type { SessionPayload } from '@/lib/auth';
import { getPrisma, prisma } from '@/lib/db';
import { isApexPlatformMode } from '@/lib/platformMode';

/** Transaction client or root Prisma client that supports $executeRaw. */
export type RlsDbClient = Prisma.TransactionClient | PrismaClient;

export interface RlsContext {
  technicianId: string;
  /** Active rooftop for dealership-scoped PII; empty/null in national scope. */
  activeDealershipId: string | null;
  dealerId: string | null;
  scopeMode: AuditScopeMode;
  /**
   * When true, tenant isolation is enforced on getRlsDb() via Prisma extension.
   * Apex defaults to enforced; Merlinus soft-open unless RLS_ENABLED forces enforce.
   */
  enforced?: boolean;
  /**
   * When true, policies allow soft-open (Merlinus only). Never set for Apex.
   */
  softOpen?: boolean;
  /** Service/seed path — skip tenant rewrite for the unit of work. */
  bypass?: boolean;
}

interface RlsAlsStore {
  ctx: RlsContext;
  /** Prisma client with tenant rewrite bound for this context (or base when bypass). */
  client: RlsDbClient;
}

const rlsStore = new AsyncLocalStorage<RlsAlsStore>();

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

/** Merlinus-only soft-open. */
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

function buildClientForContext(ctx: RlsContext): RlsDbClient {
  const base = getPrisma();
  return createRlsEnforcedClient(base, ctx) as unknown as RlsDbClient;
}

/**
 * Prisma client for the current request when inside withSessionRls / withRlsContext.
 * Returns a tenant-enforcing extension when RLS context is enforced (non-bypass).
 * Falls back to the global singleton outside an RLS context.
 */
export function getRlsDb(): RlsDbClient {
  return rlsStore.getStore()?.client ?? prisma;
}

/** Active RLS store client, if any (for joining audits into the same unit of work). */
export function getRlsTransaction(): Prisma.TransactionClient | undefined {
  const client = rlsStore.getStore()?.client;
  return client as Prisma.TransactionClient | undefined;
}

/** Current RLS context when inside withRlsContext (for tests / diagnostics). */
export function getActiveRlsContext(): RlsContext | undefined {
  return rlsStore.getStore()?.ctx;
}

/**
 * Apply tenant context for the current unit of work.
 *
 * Cloudflare D1 / SQLite has no session GUC or Postgres RLS policies.
 * Isolation is enforced by rebinding getRlsDb() to a Prisma Client extension that
 * injects dealershipId (or relation) predicates on every tenant-table query.
 */
export async function setRlsContext(_client: RlsDbClient, ctx: RlsContext): Promise<void> {
  void _client;
  const store = rlsStore.getStore();
  if (store) {
    store.ctx = ctx;
    store.client = buildClientForContext(ctx);
  }
}

/**
 * Run work with tenant context applied.
 *
 * On D1/Workers we bind an RLS-enforcing Prisma client via ALS so getRlsDb()
 * always rewrites tenant queries for this unit of work.
 */
export async function withRlsContext<T>(
  ctx: RlsContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const existing = rlsStore.getStore();
  if (existing) {
    const previousCtx = existing.ctx;
    const previousClient = existing.client;
    existing.ctx = ctx;
    existing.client = buildClientForContext(ctx);
    try {
      return await fn(existing.client as Prisma.TransactionClient);
    } finally {
      existing.ctx = previousCtx;
      existing.client = previousClient;
    }
  }

  const client = buildClientForContext(ctx);
  return rlsStore.run({ ctx, client }, () => fn(client as Prisma.TransactionClient));
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
 * Atomic multi-step work under RLS. Reuses the ambient withSessionRls client
 * when present so nested work stays on the tenant-enforcing client.
 * Pass session-derived ctx when calling outside withSessionRls (e.g. after Grok).
 */
export async function rlsTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ctx?: RlsContext
): Promise<T> {
  const existing = rlsStore.getStore();
  if (existing) {
    if (ctx) {
      await setRlsContext(existing.client, {
        ...ctx,
        enforced: ctx.enforced ?? true,
        softOpen: false,
      });
    }
    return fn(existing.client as Prisma.TransactionClient);
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
