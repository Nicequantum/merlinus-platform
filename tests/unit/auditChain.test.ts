import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AUDIT_LEGACY_PROMPT_VERSION,
  AUDIT_NON_AI_PROMPT_VERSION,
  computeAuditEntryHash,
  computeLegacyAuditEntryHash,
  verifyAuditChain,
  type AuditChainPayload,
} from '../../src/lib/auditChain';
import { PROMPT_VERSION } from '../../src/prompts/version';

const basePayload: AuditChainPayload = {
  id: 'audit-1',
  action: 'story.generate',
  entityType: 'repairLine',
  entityId: 'line-1',
  technicianId: 'tech-1',
  dealershipId: 'dealer-1',
  metadata: '{"repairOrderId":"ro-1"}',
  ipAddress: '127.0.0.1',
  createdAt: '2026-06-22T12:00:00.000Z',
  previousHash: 'GENESIS',
  promptVersion: PROMPT_VERSION,
};

describe('audit chain promptVersion', () => {
  test('computeAuditEntryHash includes promptVersion for new entries', () => {
    const withVersion = computeAuditEntryHash(basePayload);
    const withoutVersionInCanonical = computeLegacyAuditEntryHash(basePayload);
    assert.notEqual(withVersion, withoutVersionInCanonical);
  });

  test('legacy promptVersion uses pre-migration hash algorithm', () => {
    const legacyPayload = { ...basePayload, promptVersion: AUDIT_LEGACY_PROMPT_VERSION };
    const legacyHash = computeLegacyAuditEntryHash(legacyPayload);
    assert.equal(computeAuditEntryHash(legacyPayload), legacyHash);
  });

  test('verifyAuditChain validates chained entries with promptVersion', () => {
    const firstHash = computeAuditEntryHash(basePayload);
    const secondPayload: AuditChainPayload = {
      ...basePayload,
      id: 'audit-2',
      previousHash: firstHash,
      createdAt: '2026-06-22T12:01:00.000Z',
      promptVersion: PROMPT_VERSION,
    };
    const secondHash = computeAuditEntryHash(secondPayload);

    const result = verifyAuditChain([
      { ...basePayload, entryHash: firstHash },
      { ...secondPayload, entryHash: secondHash },
    ]);

    assert.equal(result.valid, true);
    assert.equal(result.brokenAt, null);
  });

  test('tampering promptVersion breaks chain verification', () => {
    const hash = computeAuditEntryHash(basePayload);
    const tampered = { ...basePayload, entryHash: hash, promptVersion: AUDIT_NON_AI_PROMPT_VERSION };
    const result = verifyAuditChain([tampered]);
    assert.equal(result.valid, false);
    assert.equal(result.brokenAt, 0);
  });
});