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
