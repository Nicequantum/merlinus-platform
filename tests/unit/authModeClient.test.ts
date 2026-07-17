import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clerkPublishableKeyConfigured,
  getClientAuthMode,
  isClerkSignInAvailable,
  shouldUseClerkOnlyLogin,
} from '../../src/lib/authModeClient';

describe('auth mode client (Phase 4 PR-2)', () => {
  test('getClientAuthMode reads NEXT_PUBLIC_AUTH_MODE with legacy default', () => {
    const saved = process.env.NEXT_PUBLIC_AUTH_MODE;
    delete process.env.NEXT_PUBLIC_AUTH_MODE;
    assert.equal(getClientAuthMode(), 'legacy');
    process.env.NEXT_PUBLIC_AUTH_MODE = 'dual';
    assert.equal(getClientAuthMode(), 'dual');
    process.env.NEXT_PUBLIC_AUTH_MODE = saved;
  });

  test('isClerkSignInAvailable requires dual/clerk mode and publishable key', () => {
    const savedMode = process.env.NEXT_PUBLIC_AUTH_MODE;
    const savedKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    process.env.NEXT_PUBLIC_AUTH_MODE = 'legacy';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_x';
    assert.equal(isClerkSignInAvailable(), false);

    process.env.NEXT_PUBLIC_AUTH_MODE = 'dual';
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    assert.equal(isClerkSignInAvailable(), false);

    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_x';
    assert.equal(isClerkSignInAvailable(), true);

    process.env.NEXT_PUBLIC_AUTH_MODE = savedMode;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedKey;
  });

  test('shouldUseClerkOnlyLogin is true only for clerk mode with publishable key', () => {
    const savedMode = process.env.NEXT_PUBLIC_AUTH_MODE;
    const savedKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    process.env.NEXT_PUBLIC_AUTH_MODE = 'dual';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_x';
    assert.equal(shouldUseClerkOnlyLogin(), false);

    process.env.NEXT_PUBLIC_AUTH_MODE = 'clerk';
    assert.equal(shouldUseClerkOnlyLogin(), true);

    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    assert.equal(shouldUseClerkOnlyLogin(), false);
    assert.equal(clerkPublishableKeyConfigured(), false);

    process.env.NEXT_PUBLIC_AUTH_MODE = savedMode;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedKey;
  });
});