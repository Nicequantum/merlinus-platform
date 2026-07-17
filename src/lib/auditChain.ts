import { createHash } from 'crypto';

export const AUDIT_GENESIS_HASH = 'GENESIS';

/** Pre-migration audit rows — hash computed without promptVersion in the canonical payload. */
export const AUDIT_LEGACY_PROMPT_VERSION = 'legacy';

/** Non-AI audit events (login, RO CRUD, etc.) that do not invoke Merlin prompts. */
export const AUDIT_NON_AI_PROMPT_VERSION = 'n/a';

/**
 * Customer Pay template applications — not Merlin AI output.
 * Hash chain retains a sentinel for immutability; warranty auditors ignore this value.
 */
export const AUDIT_CUSTOMER_PAY_SENTINEL = 'customer-pay-instant';

export interface AuditChainPayload {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  technicianId: string | null;
  dealershipId: string;
  metadata: string;
  ipAddress: string | null;
  createdAt: string;
  previousHash: string;
  promptVersion: string;
}

type LegacyAuditChainPayload = Omit<AuditChainPayload, 'promptVersion'>;

/** Legacy hash (pre promptVersion column) — preserves chain integrity for migrated rows. */
export function computeLegacyAuditEntryHash(payload: LegacyAuditChainPayload): string {
  const canonical = JSON.stringify({
    id: payload.id,
    action: payload.action,
    entityType: payload.entityType,
    entityId: payload.entityId,
    technicianId: payload.technicianId,
    dealershipId: payload.dealershipId,
    metadata: payload.metadata,
    ipAddress: payload.ipAddress,
    createdAt: payload.createdAt,
    previousHash: payload.previousHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * SHA-256 entry hash. Includes promptVersion so warranty auditors can prove which
 * Merlin prompt rules produced a given AI story or PDF export.
 */
export function computeAuditEntryHash(payload: AuditChainPayload): string {
  if (payload.promptVersion === AUDIT_LEGACY_PROMPT_VERSION) {
    return computeLegacyAuditEntryHash(payload);
  }

  const canonical = JSON.stringify({
    id: payload.id,
    action: payload.action,
    entityType: payload.entityType,
    entityId: payload.entityId,
    technicianId: payload.technicianId,
    dealershipId: payload.dealershipId,
    metadata: payload.metadata,
    ipAddress: payload.ipAddress,
    createdAt: payload.createdAt,
    previousHash: payload.previousHash,
    promptVersion: payload.promptVersion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function verifyAuditChain(
  entries: Array<{ previousHash: string; entryHash: string } & AuditChainPayload>
): { valid: boolean; brokenAt: number | null } {
  let expectedPrevious = AUDIT_GENESIS_HASH;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.previousHash !== expectedPrevious) {
      return { valid: false, brokenAt: i };
    }
    const recomputed = computeAuditEntryHash(entry);
    if (recomputed !== entry.entryHash) {
      return { valid: false, brokenAt: i };
    }
    expectedPrevious = entry.entryHash;
  }

  return { valid: true, brokenAt: null };
}