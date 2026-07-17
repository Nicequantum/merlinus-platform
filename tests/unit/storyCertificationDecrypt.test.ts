import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encryptPII } from '@/lib/encryption';
import { mapStoryCertificationFromDbLine } from '@/lib/storyCertification';

describe('story certification decrypt tolerance (H8)', () => {
  it('returns null instead of throwing when certifier name ciphertext is corrupt', () => {
    const savedKey = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = 'different-data-encryption-key-32-chars!';
    const foreignName = encryptPII('Wrong key name');
    process.env.DATA_ENCRYPTION_KEY = savedKey;

    const result = mapStoryCertificationFromDbLine({
      storyCertifiedAt: new Date('2026-06-01T12:00:00.000Z'),
      storyCertifiedByTechnicianId: 'tech-1',
      storyCertifiedByNameEncrypted: foreignName,
      storyCertifiedHash: 'abc123hash',
    });
    assert.equal(result, null);
  });

  it('maps certification when certifier name is legacy plaintext', () => {
    const result = mapStoryCertificationFromDbLine({
      storyCertifiedAt: new Date('2026-06-01T12:00:00.000Z'),
      storyCertifiedByTechnicianId: 'tech-1',
      storyCertifiedByNameEncrypted: 'Alex Technician',
      storyCertifiedHash: 'abc123hash',
    });
    assert.equal(result?.certifiedByName, 'Alex Technician');
  });

  it('maps certification when name decrypts successfully', () => {
    const name = encryptPII('Alex Technician');
    const certifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const result = mapStoryCertificationFromDbLine({
      storyCertifiedAt: certifiedAt,
      storyCertifiedByTechnicianId: 'tech-1',
      storyCertifiedByNameEncrypted: name,
      storyCertifiedHash: 'abc123hash',
    });
    assert.equal(result?.certifiedByName, 'Alex Technician');
    assert.equal(result?.certifiedByTechnicianId, 'tech-1');
    assert.equal(result?.storyHash, 'abc123hash');
  });
});