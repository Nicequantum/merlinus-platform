import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  getClientPlatformMode,
  isClientApexPlatformMode,
  isClientMerlinusPlatformMode,
} from '../../src/lib/platformModeClient';

describe('platformModeClient (Phase 5.6)', () => {
  const saved = process.env.NEXT_PUBLIC_PLATFORM_MODE;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
    } else {
      process.env.NEXT_PUBLIC_PLATFORM_MODE = saved;
    }
  });

  test('defaults to merlinus when NEXT_PUBLIC_PLATFORM_MODE is unset', () => {
    delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
    assert.equal(getClientPlatformMode(), 'merlinus');
    assert.equal(isClientMerlinusPlatformMode(), true);
    assert.equal(isClientApexPlatformMode(), false);
  });

  test('reads apex from NEXT_PUBLIC_PLATFORM_MODE', () => {
    process.env.NEXT_PUBLIC_PLATFORM_MODE = 'apex';
    assert.equal(getClientPlatformMode(), 'apex');
    assert.equal(isClientApexPlatformMode(), true);
  });
});