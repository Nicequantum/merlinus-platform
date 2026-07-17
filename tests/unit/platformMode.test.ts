import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getPlatformMode,
  isApexPlatformMode,
  isMerlinusPlatformMode,
  parsePlatformMode,
} from '../../src/lib/platformMode';

describe('platformMode (Phase 5.3)', () => {
  test('parsePlatformMode defaults to merlinus', () => {
    assert.equal(parsePlatformMode(undefined), 'merlinus');
    assert.equal(parsePlatformMode(''), 'merlinus');
    assert.equal(parsePlatformMode('   '), 'merlinus');
  });

  test('parsePlatformMode accepts apex and merlinus', () => {
    assert.equal(parsePlatformMode('apex'), 'apex');
    assert.equal(parsePlatformMode('MERLINUS'), 'merlinus');
  });

  test('parsePlatformMode rejects unknown values', () => {
    assert.throws(() => parsePlatformMode('national'), /Invalid PLATFORM_MODE/);
  });

  test('getPlatformMode reads PLATFORM_MODE from environment', () => {
    const saved = process.env.PLATFORM_MODE;
    const savedPublic = process.env.NEXT_PUBLIC_PLATFORM_MODE;
    const savedApexEnv = process.env.APEX_ENV;
    delete process.env.PLATFORM_MODE;
    delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
    delete process.env.APEX_ENV;
    assert.equal(getPlatformMode(), 'merlinus');
    assert.equal(isMerlinusPlatformMode(), true);
    assert.equal(isApexPlatformMode(), false);

    process.env.PLATFORM_MODE = 'apex';
    assert.equal(getPlatformMode(), 'apex');
    assert.equal(isApexPlatformMode(), true);

    process.env.PLATFORM_MODE = saved;
    if (savedPublic === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
    else process.env.NEXT_PUBLIC_PLATFORM_MODE = savedPublic;
    if (savedApexEnv === undefined) delete process.env.APEX_ENV;
    else process.env.APEX_ENV = savedApexEnv;
  });

  test('getPlatformMode falls back to APEX_ENV when PLATFORM_MODE unset', () => {
    const saved = process.env.PLATFORM_MODE;
    const savedPublic = process.env.NEXT_PUBLIC_PLATFORM_MODE;
    const savedApexEnv = process.env.APEX_ENV;
    delete process.env.PLATFORM_MODE;
    delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
    process.env.APEX_ENV = '1';
    assert.equal(getPlatformMode(), 'apex');
    assert.equal(isApexPlatformMode(), true);
    if (saved === undefined) delete process.env.PLATFORM_MODE;
    else process.env.PLATFORM_MODE = saved;
    if (savedPublic === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
    else process.env.NEXT_PUBLIC_PLATFORM_MODE = savedPublic;
    if (savedApexEnv === undefined) delete process.env.APEX_ENV;
    else process.env.APEX_ENV = savedApexEnv;
  });
});