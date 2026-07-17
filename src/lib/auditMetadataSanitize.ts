import { createHash } from 'crypto';
import { sanitizeIdentifier, sanitizeText } from '@/lib/sanitize';
import type { AuditAction } from '@/lib/audit';

/** Fields that must never appear in durable audit metadata (PII / story text). */
const BLOCKED_METADATA_KEYS = new Set([
  'name',
  'displayName',
  'serviceAdvisorName',
  'customerName',
  'filename',
  'warrantyStory',
  'storyText',
  'technicianNotes',
  'vin',
  'password',
  'passwordHash',
  'roNumber',
  'certifiedByName',
  'email',
  'identifier',
]);

/** Phase 6.3 — allowlist-only: unknown keys are dropped (no free-text pass-through). */
const ALLOWED_STRING_KEYS = new Set([
  'templateId',
  'templateTitle',
  'repairOrderId',
  'lineNumber',
  'd7Number',
  'pathname',
  'role',
  'routeKey',
  'promptVersion',
  'systemPromptHash',
  'dealershipRulesHash',
  'miGuidelinesHash',
  'miStyleRulesHash',
  'advisorContextHash',
  'qualityGrade',
  'action',
  'reason',
  'certifiedAt',
  'storyHash',
  'roNumberHash',
  'legalDisclaimerVersion',
  'reviewMode',
  'model',
  'extractionSource',
  'extractionStrength',
  'pathnameDigest',
  'scope',
  'consoleScope',
  'dealerGroupId',
  'outcome',
  'brand',
  'loginStrategy',
  'actorType',
  'ifExistsMode',
  'templateId',
  /** Client Idempotency-Key for create RO replay (no PII). */
  'idempotencyKey',
]);

const ALLOWED_BOOL_KEYS = new Set([
  'success',
  'hasRoNumber',
  'hasVin17',
  'hasVehicleIdentity',
  'sessionRevoked',
  'hasMore',
  'hasCursor',
  'patch',
  'idempotent',
]);

const ALLOWED_NUMBER_KEYS = new Set([
  'lineNumber',
  'durationMs',
  'resultCount',
  'limit',
  'dealerCount',
  'dealershipCount',
  'activeUsers',
  'repairOrders7d',
  'certifiedStories7d',
  'adoptionRatePct',
  'attentionFlagCount',
  'rooftopCount',
  'volumeTrendPct',
  'certificationRatePct',
  'aiUsage7d',
  'logins7d',
  'schemaVersion',
]);

/** Blind-index style hash for RO numbers (never store plaintext in audit metadata). */
export function hashRoNumberForAudit(roNumber: string): string {
  const normalized = roNumber.trim().toUpperCase();
  if (!normalized) return '';
  return createHash('sha256').update(`apex-audit-ro:${normalized}`).digest('hex').slice(0, 32);
}

/**
 * Phase 6.3 — allowlist-only audit metadata sanitization.
 * Strips PII/story content; hashes RO numbers; drops unknown keys.
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
  _action?: AuditAction
): Record<string, unknown> {
  if (!metadata) return {};

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (BLOCKED_METADATA_KEYS.has(key)) {
      // Convert plaintext RO numbers to hashes instead of dropping silently.
      if (key === 'roNumber' && typeof value === 'string' && value.trim()) {
        sanitized.roNumberHash = hashRoNumberForAudit(value);
      }
      continue;
    }

    if (key === 'd7Number' && typeof value === 'string') {
      sanitized[key] = sanitizeIdentifier(value);
      continue;
    }

    if (key === 'roNumberHash' && typeof value === 'string') {
      sanitized[key] = value.slice(0, 64);
      continue;
    }

    if (ALLOWED_STRING_KEYS.has(key) && typeof value === 'string') {
      sanitized[key] = sanitizeText(value).slice(0, 200);
      continue;
    }

    if (key.endsWith('Id') && typeof value === 'string') {
      sanitized[key] = sanitizeIdentifier(value);
      continue;
    }

    if (key.endsWith('Hash') && typeof value === 'string') {
      sanitized[key] = value.slice(0, 64);
      continue;
    }

    if (
      (key.endsWith('Count') || key.endsWith('Score') || ALLOWED_NUMBER_KEYS.has(key)) &&
      (typeof value === 'number' || typeof value === 'boolean')
    ) {
      sanitized[key] = value;
      continue;
    }

    if (ALLOWED_BOOL_KEYS.has(key) && typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }

    if (key === 'knowledgeBaseEntryIds' && Array.isArray(value)) {
      sanitized[key] = value
        .filter((id): id is string => typeof id === 'string')
        .slice(0, 20)
        .map((id) => sanitizeIdentifier(id));
      continue;
    }

    if (key === 'knowledgeBaseEntriesUsed' && Array.isArray(value)) {
      // Legacy: titles only — cap length, no story bodies.
      sanitized[key] = value
        .filter((t): t is string => typeof t === 'string')
        .slice(0, 10)
        .map((t) => sanitizeText(t).slice(0, 80));
      continue;
    }

    // Nested objects only for known operational allow-list keys (e.g. volumeTrend).
    if (key === 'volumeTrend' && value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      if (typeof nested.changePct === 'number') out.changePct = nested.changePct;
      if (typeof nested.direction === 'string') out.direction = sanitizeText(nested.direction).slice(0, 20);
      if (Object.keys(out).length) sanitized[key] = out;
      continue;
    }

    // Phase 6.3: drop unknown keys (no free-text / PII pass-through).
  }

  return sanitized;
}
