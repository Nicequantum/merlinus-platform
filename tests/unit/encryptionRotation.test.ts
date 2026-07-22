import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, before, after } from 'node:test';
import {
  encryptPII,
  decryptPII,
  getDecryptKeyCandidates,
  isDualKeyRotationActive,
  fingerprintSecret,
  generateDataEncryptionKey,
  reencryptCiphertextWithCurrentKey,
} from '@/lib/encryption';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('Encryption dual-key + rotation skeleton', () => {
  const originalKey = process.env.DATA_ENCRYPTION_KEY;
  const originalPrev = process.env.DATA_ENCRYPTION_KEY_PREVIOUS;

  before(() => {
    process.env.DATA_ENCRYPTION_KEY =
      originalKey && originalKey.length >= 32
        ? originalKey
        : 'test-primary-encryption-key-32chars-min!!';
  });

  after(() => {
    if (originalKey !== undefined) process.env.DATA_ENCRYPTION_KEY = originalKey;
    else delete process.env.DATA_ENCRYPTION_KEY;
    if (originalPrev !== undefined) process.env.DATA_ENCRYPTION_KEY_PREVIOUS = originalPrev;
    else delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
  });

  it('encrypt/decrypt roundtrip with primary', () => {
    const ct = encryptPII('hello-pii');
    assert.equal(decryptPII(ct), 'hello-pii');
  });

  it('dual-key decrypt uses previous when primary cannot open ciphertext', () => {
    const oldKey = 'old-key-material-for-rotation-tests-32c';
    const newKey = 'new-key-material-for-rotation-tests-32c';
    process.env.DATA_ENCRYPTION_KEY = oldKey;
    delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
    const legacyCipher = encryptPII('rotate-me');

    process.env.DATA_ENCRYPTION_KEY = newKey;
    process.env.DATA_ENCRYPTION_KEY_PREVIOUS = oldKey;
    assert.equal(isDualKeyRotationActive(), true);
    assert.ok(getDecryptKeyCandidates().length >= 2);
    assert.equal(decryptPII(legacyCipher), 'rotate-me');

    const rewritten = reencryptCiphertextWithCurrentKey(legacyCipher);
    assert.ok(rewritten);
    // After reencrypt, primary alone should work
    delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
    assert.equal(decryptPII(rewritten!), 'rotate-me');
  });

  it('fingerprints and key generation are stable shapes', () => {
    const fp = fingerprintSecret('abc');
    assert.equal(fp.length, 16);
    const k = generateDataEncryptionKey();
    assert.ok(k.length >= 32);
  });

  it('rotation service + API + UI exist', () => {
    assert.match(readSrc('src/lib/encryption/rotationService.ts'), /beginEncryptionRotation/);
    assert.match(readSrc('src/lib/encryption/rotationService.ts'), /runReencryptRotationJob/);
    assert.match(readSrc('src/lib/encryption/rotationService.ts'), /REENCRYPT_TABLE_PLAN/);
    assert.match(
      readSrc('src/app/api/manager/encryption/rotate/route.ts'),
      /start-reencrypt|requireManager/
    );
    assert.match(readSrc('src/components/EncryptionRotationPanel.tsx'), /Encryption key rotation/);
    assert.match(readSrc('prisma/schema.prisma'), /model EncryptionRotation/);
    assert.match(readSrc('src/lib/healthChecks.ts'), /isDualKeyRotationActive|dual-key/);
  });
});
