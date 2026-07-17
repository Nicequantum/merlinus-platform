import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  decryptComplaintsPayload,
  decryptJsonObject,
  decryptOptionalSensitiveText,
  decryptSensitiveText,
  decryptStringArray,
  encryptComplaintsPayload,
  encryptJsonObject,
  encryptOptionalSensitiveText,
  encryptPII,
  encryptSensitiveText,
  encryptStringArray,
  isLikelyEncryptedPayload,
  migratePlaintextJsonObjectToEncrypted,
  migratePlaintextToEncrypted,
} from '../../src/lib/encryption';

describe('sensitive field encryption', () => {
  before(() => {
    process.env.DATA_ENCRYPTION_KEY =
      process.env.DATA_ENCRYPTION_KEY || 'test-data-encryption-key-32-chars-min';
    process.env.SEARCH_HMAC_KEY =
      process.env.SEARCH_HMAC_KEY || 'test-search-hmac-key-32-chars-minimum!';
  });

  test('encrypts and decrypts technician notes', () => {
    const notes = 'Quick Test found P0300. Performed coil swap test.';
    const encrypted = encryptSensitiveText(notes);
    assert.notEqual(encrypted, notes);
    assert.equal(decryptSensitiveText(encrypted), notes);
  });

  test('reads legacy plaintext technician notes', () => {
    const legacy = 'Legacy plaintext notes before migration';
    assert.equal(decryptSensitiveText(legacy), legacy);
  });

  test('encrypts and decrypts OCR text arrays', () => {
    const ocrTexts = ['P0300 Random Misfire', 'Cylinder 3 misfire count: 42'];
    const encrypted = encryptStringArray(ocrTexts);
    assert.notEqual(encrypted, JSON.stringify(ocrTexts));
    assert.deepEqual(decryptStringArray(encrypted), ocrTexts);
  });

  test('reads legacy plaintext OCR JSON arrays', () => {
    const legacy = JSON.stringify(['Legacy OCR block 1', 'Legacy OCR block 2']);
    assert.deepEqual(decryptStringArray(legacy), ['Legacy OCR block 1', 'Legacy OCR block 2']);
  });

  test('encrypts and decrypts optional warranty stories', () => {
    const story = 'Customer Complaint: Check engine light on.\nCause: P0300.\nCorrection: Replaced coil.';
    const encrypted = encryptOptionalSensitiveText(story);
    assert.ok(encrypted);
    assert.notEqual(encrypted, story);
    assert.equal(decryptOptionalSensitiveText(encrypted!), story);
  });

  test('returns empty values for blank sensitive fields', () => {
    assert.equal(encryptStringArray([]), '');
    assert.deepEqual(decryptStringArray(''), []);
    assert.equal(decryptSensitiveText(''), '');
    assert.equal(decryptOptionalSensitiveText(null), undefined);
    assert.equal(encryptOptionalSensitiveText(undefined), null);
  });

  test('encrypts and decrypts JSON object fields', () => {
    const payload = { codes: ['P0300'], faultCodes: [], guidedTests: [], measurements: [], components: [], circuits: [] };
    const encrypted = encryptJsonObject(payload);
    assert.notEqual(encrypted, JSON.stringify(payload));
    assert.ok(isLikelyEncryptedPayload(encrypted));
    assert.deepEqual(decryptJsonObject(encrypted, {}), payload);
  });

  test('reads legacy plaintext JSON object fields', () => {
    const legacy = JSON.stringify({ codes: ['P0171'], faultCodes: [], guidedTests: [], measurements: [], components: [], circuits: [] });
    assert.deepEqual(decryptJsonObject(legacy, {}), JSON.parse(legacy));
  });

  test('migrates legacy plaintext to encrypted without double-encrypting', () => {
    const legacy = 'Legacy technician note';
    const encrypted = migratePlaintextToEncrypted(legacy);
    assert.notEqual(encrypted, legacy);
    assert.equal(decryptSensitiveText(encrypted), legacy);
    assert.equal(migratePlaintextToEncrypted(encrypted), encrypted);
  });

  test('migrates legacy extractedData JSON objects', () => {
    const legacy = JSON.stringify({ codes: ['P0420'], faultCodes: [], guidedTests: [], measurements: [], components: [], circuits: [] });
    const encrypted = migratePlaintextJsonObjectToEncrypted(legacy);
    assert.ok(isLikelyEncryptedPayload(encrypted));
    assert.deepEqual(decryptJsonObject(encrypted, {}), JSON.parse(legacy));
    assert.equal(migratePlaintextJsonObjectToEncrypted(encrypted), encrypted);
  });

  test('decryptJsonObject returns fallback when ciphertext cannot be decrypted', () => {
    const fallback = { codes: [] as string[] };
    const wrongKey = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = 'different-data-encryption-key-32-chars!';
    const foreign = encryptJsonObject({ codes: ['P0300'] });
    process.env.DATA_ENCRYPTION_KEY = wrongKey;

    assert.deepEqual(decryptJsonObject(foreign, fallback), fallback);
  });

  test('decryptStringArray returns empty array when ciphertext cannot be decrypted', () => {
    const wrongKey = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = 'different-data-encryption-key-32-chars!';
    const foreign = encryptStringArray(['Quick test OCR']);
    process.env.DATA_ENCRYPTION_KEY = wrongKey;

    assert.deepEqual(decryptStringArray(foreign), []);
  });

  test('decryptComplaintsPayload returns empty complaints when ciphertext cannot be decrypted', () => {
    const valid = encryptComplaintsPayload(['Check engine light']);
    assert.deepEqual(decryptComplaintsPayload(valid).complaints, ['Check engine light']);

    const wrongKey = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = 'different-data-encryption-key-32-chars!';
    const foreign = encryptComplaintsPayload(['Foreign key complaint']);
    process.env.DATA_ENCRYPTION_KEY = wrongKey;

    assert.deepEqual(decryptComplaintsPayload(foreign).complaints, []);
  });
});