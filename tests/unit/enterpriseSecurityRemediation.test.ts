import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
function readSrc(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('Enterprise security remediation (audit P0/P1)', () => {
  it('hub national scopes rooftops to enterable dealerships only', () => {
    const src = readSrc('src/app/api/hub/national/route.ts');
    assert.match(src, /listEnterableDealershipsForOwner/);
    assert.equal(src.includes("id: { not: '__apex_national__' }"), false);
  });

  it('MPI queue writes dual-scope dealershipId on mutations', () => {
    const src = readSrc('src/lib/queue/handlers/mpiReport.ts');
    assert.match(src, /tenantWhere/);
    assert.match(src, /dealershipId: msg\.dealershipId/);
    assert.equal(/updateMany\(\{\s*where:\s*\{\s*id:\s*inspectionId\s*\}/.test(src), false);
  });

  it('encryption rotation mutations require platform operator', () => {
    const src = readSrc('src/app/api/manager/encryption/rotate/route.ts');
    assert.match(src, /isPlatformOperator/);
    assert.match(src, /403/);
  });

  it('diagnostic images are dealership-prefixed under R2', () => {
    const src = readSrc('src/lib/blob.ts');
    assert.match(src, /benz-tech\/images\/\$\{safeDealer\}/);
    assert.match(src, /dealershipId\?:/);
  });

  it('share passcodes use peppered HMAC v2 with legacy verify', () => {
    const src = readSrc('src/lib/videoInspection/shareTokens.ts');
    assert.match(src, /createHmac/);
    assert.match(src, /v2:/);
    assert.match(src, /legacyHashPasscode|legacy unsalted/i);
  });

  it('share revoke endpoint exists', () => {
    const src = readSrc('src/app/api/video-inspections/[id]/share/route.ts');
    assert.match(src, /export async function DELETE/);
    assert.match(src, /revokedAt/);
    assert.match(src, /video\.share_revoke/);
  });

  it('public video views are audited and passcode gate does not leak dealership name', () => {
    const src = readSrc('src/app/api/public/video/[token]/route.ts');
    assert.match(src, /video\.public_view/);
    assert.match(src, /writeAuditLog/);
    assert.match(src, /requiresPasscode:\s*true\s*\}/);
    assert.equal(src.includes('requiresPasscode: true, dealershipName'), false);
  });

  it('companion publish uses strict schema without passthrough', () => {
    const src = readSrc('src/app/api/companion/publish/route.ts');
    assert.match(src, /discriminatedUnion/);
    assert.equal(src.includes('.passthrough()'), false);
    assert.match(src, /warrantyStory/);
  });

  it('SMS Twilio module is server-only', () => {
    const src = readSrc('src/lib/sms/twilio.ts');
    assert.match(src, /server-only/);
  });

  it('session cookies use broader production secure detection', () => {
    const auth = readSrc('src/lib/auth.ts');
    const apex = readSrc('src/lib/apex/apexSession.ts');
    assert.match(auth, /MERLIN_PRODUCTION/);
    assert.match(apex, /MERLIN_PRODUCTION/);
  });

  it('getRlsDb supports MERLIN_RLS_STRICT fail-closed', () => {
    const src = readSrc('src/lib/apex/rlsContext.ts');
    assert.match(src, /MERLIN_RLS_STRICT/);
  });

  it('images route requires dealership context', () => {
    const src = readSrc('src/app/api/images/route.ts');
    assert.match(src, /requireDealershipContext:\s*true/);
  });
});

describe('Enterprise security remediation wave 2+', () => {
  it('rate limit supports identity dimensions (user+roof)', () => {
    const src = readSrc('src/lib/rate-limit.ts');
    assert.match(src, /buildRateLimitDimension/);
    assert.match(src, /user:\$\{tech\}/);
    const route = readSrc('src/lib/apiRoute.ts');
    assert.match(route, /technicianId: session\.technicianId/);
  });

  it('MFA admin reset requires actor step-up TOTP when enrolled', () => {
    const src = readSrc('src/app/api/manager/mfa/reset/route.ts');
    assert.match(src, /actorTotpCode/);
    assert.match(src, /verifyMfaFactor/);
    assert.match(src, /method !== 'totp'/);
  });

  it('health KV probe prefers Workers KV_STORE', () => {
    const src = readSrc('src/lib/healthChecks.ts');
    assert.match(src, /getRateLimitKv|isWorkersKvConfigured/);
    assert.match(src, /Workers KV/);
  });

  it('elevated Apex access TTL is shorter than bay default', () => {
    const src = readSrc('src/lib/apex/apexSession.ts');
    assert.match(src, /ACCESS_TOKEN_TTL_ELEVATED_SECONDS|ACCESS_TOKEN_TTL_OWNER_SECONDS/);
    assert.match(src, /getAccessTtlForSession/);
    assert.match(src, /4 \* 60 \* 60|12 \* 60 \* 60/);
  });

  it('RLS relation creates assert parent dealership ownership', () => {
    const src = readSrc('src/lib/apex/rlsPrismaExtension.ts');
    assert.match(src, /assertRelationParentInTenant/);
    assert.match(src, /RELATION_PARENT_FK/);
  });

  it('companion KV redacts warranty story bodies', () => {
    const src = readSrc('src/lib/companionHub.ts');
    assert.match(src, /redactCompanionEventForKv/);
    assert.match(src, /storyUpdated/);
  });
});


describe('Enterprise security remediation wave 4', () => {
  it('critical audit set covers MFA admin reset and video share lifecycle', () => {
    const src = readSrc('src/lib/audit.ts');
    assert.match(src, /CRITICAL_AUDIT_ACTIONS[\s\S]*auth\.mfa_admin_reset/);
    assert.match(src, /CRITICAL_AUDIT_ACTIONS[\s\S]*video\.share_revoke/);
  });

  it('story AI brand load runs under withSessionRls', () => {
    const src = readSrc('src/lib/storyAiRoute.ts');
    assert.match(src, /withSessionRls\(session/);
  });

  it('RO search blind-index min fragment is at least 3', () => {
    const src = readSrc('src/lib/piiSearchToken.ts');
    assert.match(src, /MIN_RO_SEARCH_FRAGMENT_LEN = 3/);
  });

  it('audit RO hash prefers HMAC pepper', () => {
    const src = readSrc('src/lib/auditMetadataSanitize.ts');
    assert.match(src, /createHmac/);
    assert.match(src, /SEARCH_HMAC_KEY/);
  });
});
