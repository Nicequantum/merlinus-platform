/**
 * APEX NATIONAL PLATFORM — dealer tenancy context (Phase 1).
 *
 * MERLINUS SINGLE-DEALER: when dealerId is absent, all existing dealershipId-scoped
 * queries continue to behave exactly as before.
 *
 * Dealer context is derived only from the authenticated session/JWT — never from
 * client-controlled HTTP headers.
 */

export const MERLINUS_DEFAULT_DEALER_ID = 'merlinus-default-dealer';
export const MERLINUS_DEFAULT_DEALER_CODE = 'merlinus-tiverton';

export type DealerContextSource = 'session' | 'env_default' | 'legacy_default' | 'none';

export interface DealerContext {
  dealerId: string | null;
  dealershipId: string | null;
  source: DealerContextSource;
}

export interface DealerAwareSession {
  dealershipId: string;
  dealerId?: string | null;
}

/** MERLINUS SINGLE-DEALER fallback when multi-tenant hints are not configured. */
export function getLegacyDefaultDealerId(): string {
  return process.env.APEX_DEFAULT_DEALER_ID?.trim() || MERLINUS_DEFAULT_DEALER_ID;
}

/**
 * Resolve the active dealer from the authenticated session.
 * Falls back to env default, then legacy single-dealer default for Merlinus.
 */
export function resolveDealerContext(input: {
  session?: DealerAwareSession | null;
}): DealerContext {
  const dealershipId = input.session?.dealershipId ?? null;

  const sessionDealerId = input.session?.dealerId?.trim();
  if (sessionDealerId) {
    return { dealerId: sessionDealerId, dealershipId, source: 'session' };
  }

  const envDefault = process.env.APEX_DEFAULT_DEALER_ID?.trim();
  if (envDefault) {
    return { dealerId: envDefault, dealershipId, source: 'env_default' };
  }

  // MERLINUS SINGLE-DEALER — preserve backward compatibility without requiring dealerId on every query.
  return {
    dealerId: getLegacyDefaultDealerId(),
    dealershipId,
    source: 'legacy_default',
  };
}

/**
 * Pick dealerId for writes — explicit session/JWT value only.
 * MERLINUS SINGLE-DEALER: returns null when absent so writes omit dealerId (dealershipId remains authoritative).
 * Do not fall back to env/legacy defaults here — those IDs may not exist in the DB and would break FK constraints.
 */
export function resolveDealerIdForWrite(input: {
  session?: DealerAwareSession | null;
}): string | null {
  const explicit = input.session?.dealerId?.trim();
  return explicit || null;
}