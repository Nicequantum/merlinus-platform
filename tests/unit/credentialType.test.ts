import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  detectCredentialType,
  isCredentialRoleAllowed,
  isEmailCredential,
  normalizeApexUsername,
  normalizeCredentialIdentifier,
  normalizeEmailIdentifier,
} from '../../src/lib/apex/credentialType';

describe('credentialType (Phase 5.3)', () => {
  test('detectCredentialType classifies email', () => {
    assert.equal(detectCredentialType('Hombre3536@gmail.com'), 'email');
    assert.equal(detectCredentialType(' admin@dealership.com '), 'email');
  });

  test('detectCredentialType classifies D7 before username', () => {
    assert.equal(detectCredentialType('D7HARRIH'), 'd7');
    assert.equal(detectCredentialType(' d7harrih '), 'd7');
  });

  test('detectCredentialType classifies apex username', () => {
    assert.equal(detectCredentialType('honda.john.smith'), 'username');
    assert.equal(detectCredentialType('Toyota.Maria.Garcia'), 'username');
  });

  test('detectCredentialType rejects invalid identifiers', () => {
    assert.equal(detectCredentialType(''), 'invalid');
    assert.equal(detectCredentialType('   '), 'invalid');
    assert.equal(detectCredentialType('not-an-email'), 'invalid');
    assert.equal(detectCredentialType('john.smith'), 'invalid');
    assert.equal(detectCredentialType('honda.john'), 'invalid');
    assert.equal(detectCredentialType('D7'), 'invalid');
  });

  test('email is detected when @ present and shape matches', () => {
    assert.equal(isEmailCredential('user@example.com'), true);
    assert.equal(isEmailCredential('bad@domain'), false);
  });

  test('normalizeCredentialIdentifier normalizes by type', () => {
    assert.equal(normalizeEmailIdentifier(' User@Example.COM '), 'user@example.com');
    assert.equal(normalizeCredentialIdentifier('email', ' User@Example.COM '), 'user@example.com');
    assert.equal(normalizeCredentialIdentifier('d7', ' d7harrih '), 'D7HARRIH');
    assert.equal(normalizeCredentialIdentifier('username', ' Honda.John.Smith '), 'honda.john.smith');
    assert.equal(normalizeApexUsername(' Honda.John.Smith '), 'honda.john.smith');
  });

  test('isCredentialRoleAllowed enforces owner vs dealership staff', () => {
    assert.equal(isCredentialRoleAllowed('email', 'owner'), true);
    assert.equal(isCredentialRoleAllowed('email', 'manager'), false);
    assert.equal(isCredentialRoleAllowed('d7', 'technician'), true);
    assert.equal(isCredentialRoleAllowed('d7', 'owner'), false);
    assert.equal(isCredentialRoleAllowed('username', 'service_advisor'), true);
    // PR-G1: group owners may sign in with apex username (e.g. viti.james.gray)
    assert.equal(isCredentialRoleAllowed('username', 'owner'), true);
  });
});