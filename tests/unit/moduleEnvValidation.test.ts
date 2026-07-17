import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  parseModulesForceEnableDetailed,
  validateProductModuleEnvironment,
} from '../../src/lib/modules/envValidation';

describe('product module environment validation', () => {
  test('parses force enable and rejects core_story / junk', () => {
    const parsed = parseModulesForceEnableDetailed('parts, core_story, sales, not_real');
    assert.deepEqual(parsed.forced, ['parts', 'sales']);
    assert.ok(parsed.invalid.includes('core_story'));
    assert.ok(parsed.invalid.includes('not_real'));
  });

  test('production hard-fails VOICE_TWILIO_SKIP_SIGNATURE', () => {
    const result = validateProductModuleEnvironment({
      production: true,
      env: {
        VOICE_TWILIO_SKIP_SIGNATURE: 'true',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv,
    });
    assert.ok(result.hardFails.some((m) => m.includes('VOICE_TWILIO_SKIP_SIGNATURE')));
  });

  test('production hard-fails invalid MODULES_FORCE_ENABLE tokens', () => {
    const result = validateProductModuleEnvironment({
      production: true,
      env: {
        MODULES_FORCE_ENABLE: 'parts,core_story',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv,
    });
    assert.ok(result.hardFails.some((m) => m.includes('unknown module')));
    assert.ok(result.invalidForceIds.includes('core_story'));
  });

  test('SMS_ENABLED requires full Twilio trio in production', () => {
    const result = validateProductModuleEnvironment({
      production: true,
      env: {
        SMS_ENABLED: 'true',
        TWILIO_ACCOUNT_SID: 'ACxx',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv,
    });
    assert.ok(result.hardFails.some((m) => m.includes('SMS_ENABLED')));
  });

  test('voice force-enable without Twilio warns/fails', () => {
    const prod = validateProductModuleEnvironment({
      production: true,
      env: {
        MODULES_FORCE_ENABLE: 'voice_agent',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv,
    });
    assert.ok(prod.hardFails.some((m) => m.includes('voice_agent') && m.includes('TWILIO')));
  });

  test('twilio signature skip is production-fail-closed in source', () => {
    const twilio = readFileSync(resolve(process.cwd(), 'src/lib/voiceAgent/twilio.ts'), 'utf8');
    assert.ok(twilio.includes('skipRequested && !isProduction'));
  });

  test('validate-env and pre-deploy include module hardening', () => {
    const envScript = readFileSync(resolve(process.cwd(), 'scripts/validate-env.mjs'), 'utf8');
    assert.ok(envScript.includes('MODULES_FORCE_ENABLE'));
    assert.ok(envScript.includes('VOICE_TWILIO_SKIP_SIGNATURE'));
    assert.ok(envScript.includes('PRODUCT_MODULE_IDS'));

    const pre = readFileSync(resolve(process.cwd(), 'scripts/validate-pre-deploy.mjs'), 'utf8');
    assert.ok(pre.includes('checkProductModuleHardening'));
    assert.ok(pre.includes('Department inbox creates encrypt'));
  });

  test('production readiness and go-live deployment docs exist', () => {
    const pr = readFileSync(resolve(process.cwd(), 'docs/Production-Readiness-Checklist.md'), 'utf8');
    assert.ok(pr.includes('video_mpi'));
    assert.ok(pr.includes('voice_agent'));
    assert.ok(pr.includes('module.set'));
    assert.ok(pr.includes('DATA_ENCRYPTION_KEY'));

    const deploy = readFileSync(resolve(process.cwd(), 'docs/Go-Live-Deployment-Checklist.md'), 'utf8');
    assert.ok(deploy.includes('Phase 5 — Functional smoke'));
    assert.ok(deploy.includes('cdk_sync'));
  });
});
