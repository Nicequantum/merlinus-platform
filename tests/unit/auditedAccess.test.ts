import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Phase 6.1 mandatory audited access', () => {
  it('writeAuditedAccess is fail-closed', () => {
    const src = readSrc('src/lib/auditedAccess.ts');
    assert.match(src, /export async function writeAuditedAccess/);
    assert.match(src, /AuditedAccessError/);
    assert.match(src, /fail-closed|Always throws/i);
    assert.match(src, /appendAuditLogInTransaction/);
  });

  it('sensitive owner routes use writeAuditedAccess', () => {
    const summary = readSrc('src/app/api/owner/summary/route.ts');
    const enter = readSrc('src/app/api/auth/enter-dealership/route.ts');
    const exit = readSrc('src/app/api/auth/exit-dealership/route.ts');
    assert.match(summary, /writeAuditedAccess/);
    assert.match(enter, /writeAuditedAccess/);
    assert.match(exit, /writeAuditedAccess/);
    assert.doesNotMatch(summary, /writeAuditLog\(/);
    assert.doesNotMatch(enter, /writeAuditLog\(/);
    assert.doesNotMatch(exit, /writeAuditLog\(/);
  });

  it('RO create requires audited access and uses writeAuditedAccess', () => {
    const src = readSrc('src/app/api/repair-orders/route.ts');
    assert.match(src, /writeAuditedAccess/);
    assert.match(src, /requireAuditedAccess:\s*true/);
    assert.match(src, /action:\s*'ro\.create'/);
  });

  it('apiRoute documents requireAuditedAccess option', () => {
    const src = readSrc('src/lib/apiRoute.ts');
    assert.match(src, /requireAuditedAccess/);
    assert.match(src, /ownerMayExerciseDealershipPrivilege/);
  });
});
