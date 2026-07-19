import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Phase 6.2 RLS enforcement expansion', () => {
  it('rlsContext provides getRlsDb, withSessionRls, rlsTransaction', () => {
    const src = readSrc('src/lib/apex/rlsContext.ts');
    assert.match(src, /export function getRlsDb/);
    assert.match(src, /export async function withSessionRls/);
    assert.match(src, /export async function rlsTransaction/);
    assert.match(src, /AsyncLocalStorage/);
    assert.match(src, /enforced:\s*true/);
    assert.match(src, /createRlsEnforcedClient/);
  });

  it('withAuth defaults useRls for dealership-context routes', () => {
    const src = readSrc('src/lib/apiRoute.ts');
    assert.match(src, /withSessionRls/);
    assert.match(src, /useRls/);
    assert.match(src, /requireDealershipContext === true/);
  });

  it('PII access helpers use getRlsDb', () => {
    const access = readSrc('src/lib/repairOrderAccess.ts');
    assert.match(access, /getRlsDb/);
    assert.equal(access.includes("from '@/lib/db'"), false);
  });

  it('critical RO routes use getRlsDb or rlsTransaction', () => {
    const list = readSrc('src/app/api/repair-orders/route.ts');
    const byId = readSrc('src/app/api/repair-orders/[id]/route.ts');
    const gen = readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts');
    assert.match(list, /getRlsDb|rlsTransaction/);
    assert.match(byId, /getRlsDb|rlsTransaction/);
    assert.match(gen, /rlsTransaction/);
    assert.doesNotMatch(gen, /prisma\.\$transaction/);
  });

  it('sessionRevocation consolidates JWT + apex refresh + Clerk', () => {
    const src = readSrc('src/lib/sessionRevocation.ts');
    assert.match(src, /revokeAllSessionsForTechnician/);
    assert.match(src, /revokeApexRefreshForScopeSwitch/);
    assert.match(src, /incrementSessionVersion/);
    assert.match(src, /revokeAllRefreshTokensForTechnician/);
  });

  it('sensitive routes call writeAuditedAccess', () => {
    const getRo = readSrc('src/app/api/repair-orders/[id]/route.ts');
    const auditLogs = readSrc('src/app/api/audit-logs/route.ts');
    const logout = readSrc('src/app/api/auth/logout/route.ts');
    const changePw = readSrc('src/app/api/auth/change-password/route.ts');
    assert.match(getRo, /writeAuditedAccess/);
    assert.match(getRo, /action:\s*'ro\.read'/);
    assert.match(auditLogs, /action:\s*'audit\.access'/);
    assert.match(logout, /revokeAllSessionsForTechnician/);
    assert.match(changePw, /revokeAllSessionsForTechnician/);
  });
});
