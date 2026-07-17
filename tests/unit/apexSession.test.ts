import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getAccessTokenTtlSeconds,
  getRefreshTokenTtlSeconds,
  hashClientIp,
  resolveScopeModeForRole,
  sha256Hex,
} from '../../src/lib/apex/apexSession';

describe('apexSession helpers (Phase 5.4)', () => {
  test('sha256Hex is deterministic', () => {
    assert.equal(sha256Hex('test-token'), sha256Hex('test-token'));
    assert.notEqual(sha256Hex('a'), sha256Hex('b'));
  });

  test('hashClientIp returns null for unknown', () => {
    assert.equal(hashClientIp('unknown'), null);
    assert.equal(hashClientIp(''), null);
  });

  test('hashClientIp hashes valid IPs', () => {
    const saved = process.env.SESSION_IP_SALT;
    process.env.SESSION_IP_SALT = 'test-salt';
    const hashed = hashClientIp('203.0.113.10');
    assert.ok(hashed);
    assert.equal(hashed, hashClientIp('203.0.113.10'));
    process.env.SESSION_IP_SALT = saved;
  });

  test('token TTL defaults', () => {
    const savedAccess = process.env.ACCESS_TOKEN_TTL_SECONDS;
    const savedRefresh = process.env.REFRESH_TOKEN_TTL_SECONDS;
    delete process.env.ACCESS_TOKEN_TTL_SECONDS;
    delete process.env.REFRESH_TOKEN_TTL_SECONDS;
    assert.equal(getAccessTokenTtlSeconds(), 15 * 60);
    assert.equal(getRefreshTokenTtlSeconds(), 7 * 24 * 60 * 60);
    process.env.ACCESS_TOKEN_TTL_SECONDS = savedAccess;
    process.env.REFRESH_TOKEN_TTL_SECONDS = savedRefresh;
  });

  test('resolveScopeModeForRole maps owner to national', () => {
    assert.equal(resolveScopeModeForRole('owner'), 'national');
    assert.equal(resolveScopeModeForRole('manager'), 'dealership');
  });
});