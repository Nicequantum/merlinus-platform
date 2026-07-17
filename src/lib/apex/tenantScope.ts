import type { AuditScopeMode } from '@/lib/apex/platformConstants';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { scopedDealershipWhere } from '@/lib/apex/dealerScope';
import { isApexPlatformMode } from '@/lib/platformMode';
import type { SessionPayload } from '@/lib/auth';

/** Thrown when an owner in national scope attempts dealership PII access. */
export class DealershipScopeRequiredError extends Error {
  readonly code = 'DEALERSHIP_CONTEXT_REQUIRED';

  constructor(message = 'Dealership context required') {
    super(message);
    this.name = 'DealershipScopeRequiredError';
  }
}

export type TenantScopedSession = Pick<
  SessionPayload,
  'role' | 'dealershipId' | 'dealerId' | 'scopeMode' | 'isOwner' | 'activeDealershipId'
>;

export function isOwnerRole(role: string): boolean {
  return role === 'owner';
}

/** MERLINUS: always dealership. APEX owners default to national until enter-dealership. */
export function resolveSessionScopeMode(session: TenantScopedSession): AuditScopeMode {
  if (!isApexPlatformMode()) return 'dealership';
  if (!isOwnerRole(session.role)) return 'dealership';
  return session.scopeMode ?? 'national';
}

export function enrichSessionWithTenantScope(session: SessionPayload): SessionPayload {
  const scopeMode = isApexPlatformMode()
    ? isOwnerRole(session.role)
      ? (session.scopeMode ?? 'national')
      : 'dealership'
    : 'dealership';
  const isOwner = isOwnerRole(session.role);
  const activeDealershipId =
    scopeMode === 'dealership' ? session.activeDealershipId ?? session.dealershipId : undefined;

  return {
    ...session,
    scopeMode,
    isOwner,
    activeDealershipId,
  };
}

/** True when the id is a real rooftop (not empty / national sentinel). */
export function isUsableDealershipId(dealershipId: string | null | undefined): boolean {
  const id = dealershipId?.trim() || '';
  return Boolean(id) && id !== APEX_NATIONAL_DEALERSHIP_ID;
}

/**
 * True when session may access dealership-scoped customer PII and RO data.
 * Phase 6.1: owners must be in dealership scope with a non-sentinel active rooftop.
 */
export function canAccessDealershipPii(session: TenantScopedSession): boolean {
  if (!isApexPlatformMode()) return true;
  if (!isOwnerRole(session.role)) return true;
  if (resolveSessionScopeMode(session) !== 'dealership') return false;
  const active = session.activeDealershipId?.trim() || session.dealershipId?.trim() || '';
  return isUsableDealershipId(active);
}

/** Owner on platform national or group home — allowed on /api/owner/* (not in a rooftop). */
export function canAccessNationalConsole(session: TenantScopedSession): boolean {
  if (!isApexPlatformMode()) return false;
  if (!isOwnerRole(session.role)) return false;
  const scope = resolveSessionScopeMode(session);
  return scope === 'national' || scope === 'group';
}

export function isOwnerGroupScope(session: TenantScopedSession): boolean {
  return isOwnerRole(session.role) && resolveSessionScopeMode(session) === 'group';
}

export function isOwnerPlatformNationalScope(session: TenantScopedSession): boolean {
  return isOwnerRole(session.role) && resolveSessionScopeMode(session) === 'national';
}

/**
 * Phase 6.1 owner least-privilege: national-scope owners cannot exercise
 * dealership admin/manager capabilities (isAdmin seed flag is not enough).
 */
export function ownerMayExerciseDealershipPrivilege(session: TenantScopedSession): boolean {
  if (!isOwnerRole(session.role)) return true;
  if (!isApexPlatformMode()) return true;
  return canAccessDealershipPii(session);
}

/**
 * Phase 6.3 / G2 — owner home console (platform national or group).
 * Must not be used while owner is in a rooftop — exit first.
 */
export function requireOwnerNationalScope(session: TenantScopedSession): void {
  if (!isOwnerRole(session.role) || !isApexPlatformMode()) {
    throw new DealershipScopeRequiredError('Owner national or group scope required');
  }
  if (!canAccessNationalConsole(session)) {
    throw new DealershipScopeRequiredError(
      'Exit dealership context before using the owner console'
    );
  }
}

/**
 * Resolve active rooftop + dealer for PII queries — throws when national owner lacks context.
 */
export function requireDealershipScope(session: TenantScopedSession): {
  dealershipId: string;
  dealerId: string | null;
} {
  if (!canAccessDealershipPii(session)) {
    throw new DealershipScopeRequiredError();
  }

  const dealershipId = (
    session.activeDealershipId?.trim() ||
    session.dealershipId?.trim() ||
    ''
  );
  if (!isUsableDealershipId(dealershipId)) {
    throw new DealershipScopeRequiredError('Dealership context required — national sentinel is not a rooftop');
  }

  return {
    dealershipId,
    dealerId: session.dealerId?.trim() || null,
  };
}

/** Prisma where clause for PII tables — enforces dealership context for national owners. */
export function scopedPiiWhere(
  session: TenantScopedSession
): { dealershipId: string; dealerId?: string } {
  const scope = requireDealershipScope(session);
  return scopedDealershipWhere(scope.dealershipId, scope.dealerId);
}

export function isSentinelNationalDealership(dealershipId: string): boolean {
  return dealershipId === APEX_NATIONAL_DEALERSHIP_ID;
}