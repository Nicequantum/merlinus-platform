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
  canDecryptWithPrimaryKeyOnly,
  requiresPreviousKeyToDecrypt,
} from '@/lib/encryption';
import {
  REENCRYPT_TABLE_PLAN,
  getReencryptCoverageSummary,
  MFA_REENCRYPT_TABLES,
} from '@/lib/encryption/reencryptPlan';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

/** Parse prisma/schema.prisma for model → *Encrypted fields (AES inventory). */
function parseSchemaEncryptedFields(schema: string): Map<string, string[]> {
  const byModel = new Map<string, string[]>();
  let currentModel: string | null = null;
  for (const line of schema.split(/\r?\n/)) {
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = modelMatch[1]!;
      if (!byModel.has(currentModel)) byModel.set(currentModel, []);
      continue;
    }
    if (line.trim() === '}') {
      currentModel = null;
      continue;
    }
    if (!currentModel) continue;
    const fieldMatch = line.match(/^\s*(\w*Encrypted)\s+/);
    if (fieldMatch) {
      byModel.get(currentModel)!.push(fieldMatch[1]!);
    }
  }
  return byModel;
}

function modelToClientName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
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
    assert.equal(canDecryptWithPrimaryKeyOnly(legacyCipher), false);
    assert.equal(requiresPreviousKeyToDecrypt(legacyCipher), true);

    const rewritten = reencryptCiphertextWithCurrentKey(legacyCipher);
    assert.ok(rewritten);
    // After reencrypt, primary alone should work
    delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
    assert.equal(decryptPII(rewritten!), 'rotate-me');
    assert.equal(canDecryptWithPrimaryKeyOnly(rewritten!), true);
    assert.equal(requiresPreviousKeyToDecrypt(rewritten!), false);
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
    assert.match(readSrc('src/components/EncryptionRotationPanel.tsx'), /Full re-encrypt coverage/);
    assert.match(readSrc('prisma/schema.prisma'), /model EncryptionRotation/);
    assert.match(readSrc('src/lib/healthChecks.ts'), /isDualKeyRotationActive|dual-key/);
    assert.match(readSrc('src/lib/healthChecks.ts'), /probeStaleMfaCiphertext|stillOnPreviousKey/);
  });

  it('P0-1 REENCRYPT_TABLE_PLAN covers MFA + every *Encrypted schema column', () => {
    const coverage = getReencryptCoverageSummary();
    assert.equal(coverage.includesMfa, true);
    assert.ok(coverage.tableCount >= 20, `expected broad table plan, got ${coverage.tableCount}`);
    assert.ok(coverage.columnCount >= 40, `expected full column inventory, got ${coverage.columnCount}`);

    for (const t of MFA_REENCRYPT_TABLES) {
      assert.ok(
        REENCRYPT_TABLE_PLAN.some((p) => p.table === t),
        `missing MFA table ${t}`
      );
    }

    const userMfa = REENCRYPT_TABLE_PLAN.find((p) => p.table === 'userMfa');
    assert.ok(userMfa?.columns.includes('secretEncrypted'));
    assert.ok(userMfa?.columns.includes('backupCodesEncrypted'));
    const tech = REENCRYPT_TABLE_PLAN.find((p) => p.table === 'technician');
    assert.ok(tech?.columns.includes('mfaSecretEncrypted'));
    assert.ok(tech?.columns.includes('mfaBackupCodesEncrypted'));

    const schemaFields = parseSchemaEncryptedFields(readSrc('prisma/schema.prisma'));
    const planned = new Map<string, Set<string>>();
    for (const entry of REENCRYPT_TABLE_PLAN) {
      planned.set(entry.table, new Set(entry.columns));
    }

    const missing: string[] = [];
    for (const [model, fields] of schemaFields) {
      const client = modelToClientName(model);
      const set = planned.get(client);
      for (const field of fields) {
        if (!set?.has(field)) {
          missing.push(`${model}.${field} (client ${client})`);
        }
      }
    }
    assert.deepEqual(
      missing,
      [],
      `REENCRYPT_TABLE_PLAN missing schema AES columns:\n${missing.join('\n')}`
    );
  });
});
