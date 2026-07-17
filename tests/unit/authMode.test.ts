import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clerkEnvConfigured,
  getAuthMode,
  isClerkAuthPathEnabled,
  isLegacyAuthPathEnabled,
  parseAuthMode,
} from '../../src/lib/authMode';

describe('auth mode (Phase 4 PR-1)', () => {
  test('parseAuthMode defaults to legacy when unset', () => {
    assert.equal(parseAuthMode(undefined), 'legacy');
    assert.equal(parseAuthMode(''), 'legacy');
    assert.equal(parseAuthMode('   '), 'legacy');
  });

  test('parseAuthMode accepts legacy, dual, and clerk', () => {
    assert.equal(parseAuthMode('legacy'), 'legacy');
    assert.equal(parseAuthMode('DUAL'), 'dual');
    assert.equal(parseAuthMode(' clerk '), 'clerk');
  });

  test('parseAuthMode rejects unknown values', () => {
    assert.throws(() => parseAuthMode('oauth'), /Invalid AUTH_MODE/);
  });

  test('isClerkAuthPathEnabled is false for legacy mode', () => {
    const savedMode = process.env.AUTH_MODE;
    const savedSecret = process.env.CLERK_SECRET_KEY;
    const savedPublishable = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    process.env.AUTH_MODE = 'legacy';
    process.env.CLERK_SECRET_KEY = 'sk_test_x';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_x';

    assert.equal(isClerkAuthPathEnabled(), false);
    assert.equal(isLegacyAuthPathEnabled(), true);

    process.env.AUTH_MODE = savedMode;
    process.env.CLERK_SECRET_KEY = savedSecret;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedPublishable;
  });

  test('isClerkAuthPathEnabled requires keys in dual mode', () => {
    const savedMode = process.env.AUTH_MODE;
    const savedSecret = process.env.CLERK_SECRET_KEY;
    const savedPublishable = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    process.env.AUTH_MODE = 'dual';
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    assert.equal(clerkEnvConfigured(), false);
    assert.equal(isClerkAuthPathEnabled(), false);

    process.env.CLERK_SECRET_KEY = 'sk_test_x';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_x';
    assert.equal(isClerkAuthPathEnabled(), true);

    process.env.AUTH_MODE = savedMode;
    process.env.CLERK_SECRET_KEY = savedSecret;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedPublishable;
  });

  test('getAuthMode reads AUTH_MODE from environment', () => {
    const saved = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'dual';
    assert.equal(getAuthMode(), 'dual');
    process.env.AUTH_MODE = saved;
  });

  test('isLegacyAuthPathEnabled is false only for clerk-only mode', () => {
    const saved = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'clerk';
    assert.equal(isLegacyAuthPathEnabled(), false);
    process.env.AUTH_MODE = 'dual';
    assert.equal(isLegacyAuthPathEnabled(), true);
    process.env.AUTH_MODE = saved;
  });
});