import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  describeTenantIsolation,
  getTenantIsolationMode,
  TENANT_ISOLATION_MODE,
} from '@/lib/tenantIsolation';
import { getCdkLiveSyncStatus, isCdkLiveSyncAvailable } from '@/lib/cdk/status';
import {
  getVoiceRealtimeStatus,
  isVoiceRealtimePremiumEnabled,
} from '@/lib/voiceAgent/realtimeConfig';
import {
  generateRecoveryToken,
  hashRecoveryToken,
  isPasswordRecoveryEnabled,
  RECOVERY_GENERIC_MESSAGE,
} from '@/lib/passwordRecovery';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('P3-1 multi-tenant isolation stance', () => {
  it('declares application_layer_d1 mode', () => {
    assert.equal(getTenantIsolationMode(), TENANT_ISOLATION_MODE);
    assert.equal(TENANT_ISOLATION_MODE, 'application_layer_d1');
    const d = describeTenantIsolation();
    assert.equal(d.databaseEnforced, false);
    assert.match(d.docs, /Multi-Tenant-Isolation/);
  });

  it('docs exist', () => {
    assert.match(readSrc('docs/Multi-Tenant-Isolation.md'), /application-layer/);
    assert.match(readSrc('docs/Multi-Tenant-Isolation.md'), /Postgres RLS/);
  });
});

describe('P3-2 voice realtime premium flag', () => {
  it('defaults to gather path', () => {
    const env = { ...process.env };
    delete env.VOICE_REALTIME_PREMIUM;
    assert.equal(isVoiceRealtimePremiumEnabled(env), false);
    const status = getVoiceRealtimeStatus(env);
    assert.equal(status.productionDefault, 'twilio_gather');
    assert.equal(status.workerdCompatible, false);
  });

  it('session route scaffold exists', () => {
    const src = readSrc('src/app/api/voice/realtime/session/route.ts');
    assert.match(src, /VOICE_REALTIME_DISABLED/);
    assert.match(src, /requireModule: 'voice_agent'/);
  });
});

describe('P3-3 CDK deferred', () => {
  it('live sync is not available by default', () => {
    assert.equal(isCdkLiveSyncAvailable({}), false);
    const s = getCdkLiveSyncStatus({});
    assert.equal(s.deferred, true);
    assert.equal(s.clipboardPasteAvailable, true);
    assert.equal(s.moduleId, 'cdk_sync');
  });

  it('docs and manager copy reference deferred', () => {
    assert.match(readSrc('docs/CDK-Sync-Deferred.md'), /not shipping live API sync/i);
    assert.match(readSrc('src/components/ManagerDashboard.tsx'), /deferred/i);
  });
});

describe('P3-4 password recovery', () => {
  it('token hash is stable and recovery disabled by default', () => {
    assert.equal(isPasswordRecoveryEnabled({}), false);
    const t = generateRecoveryToken();
    assert.ok(t.length >= 32);
    assert.equal(hashRecoveryToken(t), hashRecoveryToken(t));
    assert.notEqual(hashRecoveryToken(t), hashRecoveryToken(t + 'x'));
    assert.ok(RECOVERY_GENERIC_MESSAGE.length > 20);
  });

  it('routes and login UI exist', () => {
    assert.match(readSrc('src/app/api/auth/password-recovery/request/route.ts'), /withPublicRoute/);
    assert.match(readSrc('src/app/api/auth/password-recovery/confirm/route.ts'), /hashRecoveryToken/);
    assert.match(readSrc('src/components/LoginView.tsx'), /Forgot password/);
    assert.match(readSrc('src/lib/publicRoutes.ts'), /password-recovery/);
    assert.match(readSrc('src/lib/apex/rlsTenantRegistry.ts'), /PasswordRecoveryToken/);
  });
});
