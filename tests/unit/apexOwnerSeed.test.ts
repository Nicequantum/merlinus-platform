import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, test } from 'node:test';
import {
  readApexOwnerSeedConfig,
  APEX_GENERIC_TEST_ROOFTOP_NAME,
  APEX_GENERIC_TEST_TEMPLATE_ID,
  APEX_SEED_PRIMARY_DEALERSHIP_ID,
  APEX_SEED_SECOND_DEALERSHIP_ID,
  APEX_TEST_PLATFORM_ROOFTOP_NAME,
  APEX_TEST_PLATFORM_TEMPLATE_ID,
} from '../../src/lib/apex/seedOwnerAccounts';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Apex owner seed (Phase 5.10 / Phase 6.1 security)', () => {
  it('seedOwnerAccounts uses env vars only — no hard-coded credentials', () => {
    const src = readSrc('src/lib/apex/seedOwnerAccounts.ts');
    assert.match(src, /OWNER_SEED_EMAIL/);
    assert.match(src, /OWNER_SEED_PASSWORD/);
    assert.match(src, /OWNER_SEED_EMAIL_2/);
    assert.match(src, /OWNER_SEED_PASSWORD_2/);
    assert.match(src, /MULTI_ROOFTOP_SEED_USERNAME/);
    assert.match(src, /APEX_NATIONAL_DEALERSHIP_ID/);
    assert.match(src, /role: 'owner'/);
    assert.match(src, /d7Number: null/);
    assert.match(src, /ensureNationalOwnerAccount/);
    assert.match(src, /config\.owners/);
    assert.match(src, /ensureApexPlatformOwners/);
    assert.match(src, /Create-only/);
    assert.doesNotMatch(src, /Bressette1735/);
    assert.doesNotMatch(src, /Getfused123/);
    assert.doesNotMatch(src, /hombre3536@gmail\.com/);
    assert.doesNotMatch(src, /scollier@getfused\.com/);
    assert.doesNotMatch(src, /devPassword/);
    assert.doesNotMatch(src, /PLATFORM_OWNER_SPECS/);
  });

  it('login path does not re-seed owners on failed password', () => {
    const src = readSrc('src/app/api/auth/login/route.ts');
    assert.doesNotMatch(src, /ensureApexPlatformOwners/);
    assert.doesNotMatch(src, /owner_login_heal/);
  });

  it('seedDatabase wires optional apex owner seed', () => {
    const src = readSrc('src/lib/seedDatabase.ts');
    assert.match(src, /runApexOwnerSeedIfConfigured/);
    assert.match(src, /ownerEmail/);
  });

  it('.env.example documents owner seed and platform operator allowlist', () => {
    const env = readSrc('.env.example');
    assert.match(env, /OWNER_SEED_EMAIL/);
    assert.match(env, /OWNER_SEED_PASSWORD/);
    assert.match(env, /APEX_PLATFORM_OWNER_EMAILS/);
    assert.match(env, /MULTI_ROOFTOP_SEED_USERNAME/);
  });

  it('integration suite covers owner login, summary, enter/exit, multi-rooftop', () => {
    const src = readSrc('tests/integration/apex-owner-flows.test.ts');
    assert.match(src, /INTEGRATION_OWNER_EMAIL/);
    assert.match(src, /getOwnerSummary/);
    assert.match(src, /postEnterDealership/);
    assert.match(src, /postExitDealership/);
    assert.match(src, /requiresDealershipSelection/);
    assert.match(src, /DEALERSHIP_CONTEXT_REQUIRED/);
  });

  test('readApexOwnerSeedConfig is null without env credentials', () => {
    const saved = {
      e1: process.env.OWNER_SEED_EMAIL,
      p1: process.env.OWNER_SEED_PASSWORD,
      n1: process.env.OWNER_SEED_NAME,
      e2: process.env.OWNER_SEED_EMAIL_2,
      p2: process.env.OWNER_SEED_PASSWORD_2,
      n2: process.env.OWNER_SEED_NAME_2,
    };
    delete process.env.OWNER_SEED_EMAIL;
    delete process.env.OWNER_SEED_PASSWORD;
    delete process.env.OWNER_SEED_NAME;
    delete process.env.OWNER_SEED_EMAIL_2;
    delete process.env.OWNER_SEED_PASSWORD_2;
    delete process.env.OWNER_SEED_NAME_2;
    try {
      assert.equal(readApexOwnerSeedConfig(), null);
    } finally {
      for (const [key, value] of Object.entries({
        OWNER_SEED_EMAIL: saved.e1,
        OWNER_SEED_PASSWORD: saved.p1,
        OWNER_SEED_NAME: saved.n1,
        OWNER_SEED_EMAIL_2: saved.e2,
        OWNER_SEED_PASSWORD_2: saved.p2,
        OWNER_SEED_NAME_2: saved.n2,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('readApexOwnerSeedConfig supports national owners via env only', () => {
    const saved = {
      e1: process.env.OWNER_SEED_EMAIL,
      p1: process.env.OWNER_SEED_PASSWORD,
      n1: process.env.OWNER_SEED_NAME,
      e2: process.env.OWNER_SEED_EMAIL_2,
      p2: process.env.OWNER_SEED_PASSWORD_2,
      n2: process.env.OWNER_SEED_NAME_2,
    };
    process.env.OWNER_SEED_EMAIL = 'owner.one@example.com';
    process.env.OWNER_SEED_PASSWORD = 'password-one-strong';
    process.env.OWNER_SEED_NAME = 'Owner One';
    process.env.OWNER_SEED_EMAIL_2 = 'owner.two@example.com';
    process.env.OWNER_SEED_PASSWORD_2 = 'password-two-strong';
    process.env.OWNER_SEED_NAME_2 = 'Owner Two';
    try {
      const config = readApexOwnerSeedConfig();
      assert.ok(config);
      const emails = config!.owners.map((o) => o.email);
      assert.deepEqual(emails.sort(), ['owner.one@example.com', 'owner.two@example.com'].sort());
      assert.equal(config!.owners.find((o) => o.email === 'owner.one@example.com')?.password, 'password-one-strong');
    } finally {
      for (const [key, value] of Object.entries({
        OWNER_SEED_EMAIL: saved.e1,
        OWNER_SEED_PASSWORD: saved.p1,
        OWNER_SEED_NAME: saved.n1,
        OWNER_SEED_EMAIL_2: saved.e2,
        OWNER_SEED_PASSWORD_2: saved.p2,
        OWNER_SEED_NAME_2: saved.n2,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('seed rooftop ids and clean test names are stable', () => {
    assert.equal(APEX_SEED_PRIMARY_DEALERSHIP_ID, 'seed-dealership');
    assert.equal(APEX_SEED_SECOND_DEALERSHIP_ID, 'seed-dealership-2');
    assert.equal(APEX_TEST_PLATFORM_ROOFTOP_NAME, 'Staging - Mercedes-Benz Dealers');
    assert.equal(APEX_TEST_PLATFORM_TEMPLATE_ID, 'mercedes-rooftop-v1');
    assert.equal(APEX_GENERIC_TEST_ROOFTOP_NAME, 'Apex Generic Test');
    assert.equal(APEX_GENERIC_TEST_TEMPLATE_ID, 'generic-rooftop-v1');
  });
});
