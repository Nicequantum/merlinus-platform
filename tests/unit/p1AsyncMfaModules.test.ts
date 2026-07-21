import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  DEMO_SEED_MODULE_IDS,
  PROVISION_DEFAULT_MODULE_IDS,
  SEED_ENABLED_MODULE_IDS,
} from '@/lib/modules/catalog';
import {
  buildMfaSessionFlags,
  isMfaEnforcementEnabled,
  roleRequiresMfaEnrollment,
} from '@/lib/mfa/policy';
import { generateTotpCode, generateTotpSecret, verifyTotpCode } from '@/lib/mfa/totp';

const root = resolve(process.cwd());

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('P1-1 async AI jobs', () => {
  it('exposes job service, schedule, and poll route', () => {
    assert.match(readSrc('src/lib/aiJobs/service.ts'), /createAiJob/);
    assert.match(readSrc('src/lib/aiJobs/schedule.ts'), /scheduleBackgroundWork/);
    assert.match(readSrc('src/app/api/ai-jobs/[id]/route.ts'), /getAiJobForTechnician/);
    assert.match(readSrc('src/lib/apex/rlsTenantRegistry.ts'), /AiJob/);
  });

  it('hub summarize supports async job mode', () => {
    const src = readSrc('src/app/api/hub/conversations/[callId]/summarize/route.ts');
    assert.match(src, /wantAsync/);
    assert.match(src, /hub\.summarize/);
    assert.match(src, /pollUrl/);
    assert.match(src, /scheduleBackgroundWork/);
  });
});

describe('P1-2 session warmup', () => {
  it('has session warmup route and client keep-alive', () => {
    assert.match(readSrc('src/app/api/session/warmup/route.ts'), /session\.warmup/);
    assert.match(readSrc('src/lib/clientFetchRetry.ts'), /warmSessionIsolate/);
    assert.match(readSrc('src/lib/clientFetchRetry.ts'), /startBaySessionKeepAlive/);
    assert.match(readSrc('src/lib/loginSession.ts'), /warmSessionIsolate/);
    assert.match(readSrc('src/components/BenzTechAuthenticatedApp.tsx'), /startBaySessionKeepAlive/);
  });
});

describe('P1-3 MFA foundation', () => {
  it('TOTP generate/verify roundtrip', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    assert.equal(verifyTotpCode(secret, code), true);
    assert.equal(verifyTotpCode(secret, '000000'), false);
  });

  it('enforcement is off by default', () => {
    const env = { ...process.env };
    delete env.MERLIN_MFA_ENFORCE;
    assert.equal(isMfaEnforcementEnabled(env), false);
    assert.equal(roleRequiresMfaEnrollment('manager', env), false);
  });

  it('enforcement flags managers when MERLIN_MFA_ENFORCE=true', () => {
    const env = { MERLIN_MFA_ENFORCE: 'true' } as NodeJS.ProcessEnv;
    assert.equal(isMfaEnforcementEnabled(env), true);
    assert.equal(roleRequiresMfaEnrollment('manager', env), true);
    assert.equal(roleRequiresMfaEnrollment('technician', env), false);
    const needs = buildMfaSessionFlags({
      role: 'manager',
      mfaEnabled: false,
      mfaEnrolledAt: null,
      env,
    });
    assert.equal(needs.mfaRequired, true);
    const enrolled = buildMfaSessionFlags({
      role: 'manager',
      mfaEnabled: true,
      mfaEnrolledAt: new Date(),
      env,
    });
    assert.equal(enrolled.mfaRequired, false);
    assert.equal(enrolled.mfaEnrolled, true);
  });

  it('mfa routes and withAuth skipMfa exist', () => {
    assert.match(readSrc('src/app/api/auth/mfa/enroll/route.ts'), /generateTotpSecret/);
    assert.match(readSrc('src/app/api/auth/mfa/verify/route.ts'), /verifyTotpCode/);
    assert.match(readSrc('src/lib/apiRoute.ts'), /skipMfa/);
    assert.match(readSrc('src/lib/apiRoute.ts'), /MFA_REQUIRED/);
  });
});

describe('P1-4 commercial module defaults', () => {
  it('provision defaults are empty; demo seed is full pilot set', () => {
    assert.equal(PROVISION_DEFAULT_MODULE_IDS.length, 0);
    assert.equal(SEED_ENABLED_MODULE_IDS.length, 0);
    assert.ok(DEMO_SEED_MODULE_IDS.includes('video_mpi'));
    assert.ok(DEMO_SEED_MODULE_IDS.includes('calendar_hub'));
    assert.ok(!DEMO_SEED_MODULE_IDS.includes('cdk_sync' as never));
  });

  it('seedDatabase uses DEMO_SEED_MODULE_IDS', () => {
    assert.match(readSrc('src/lib/seedDatabase.ts'), /DEMO_SEED_MODULE_IDS/);
  });
});
