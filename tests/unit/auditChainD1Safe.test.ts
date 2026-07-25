import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { buildFindFirstTenantWhereForTests } from '@/lib/apex/rlsPrismaExtension';
import { isRetryableDbTransientError } from '@/lib/dbRetry';
import { mapRouteError } from '@/lib/routeErrorMapper';

describe('audit chain + D1-safe create path', () => {
  it('reads last hash on base client via $queryRaw first (not RLS-extended findMany)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/audit.ts'), 'utf8');
    assert.match(src, /readLastAuditEntryHashForDealership/);
    assert.match(src, /getDb\(\)/);
    assert.match(src, /SELECT\s+"entryHash"/);
    assert.match(src, /FROM\s+"AuditLog"/);
    // Must not use ambient tx for chain read first
    const appendStart = src.indexOf('export async function appendAuditLogInTransaction');
    const appendBody = src.slice(appendStart, appendStart + 2500);
    assert.match(appendBody, /readLastAuditEntryHashForDealership\(input\.dealershipId\)/);
    assert.doesNotMatch(
      appendBody.slice(0, 800),
      /tx\.auditLog\.findMany|tx\.\$queryRaw/
    );
  });

  it('RLS pins flat dealershipId for findMany-style where (no AND double dealershipId)', () => {
    const where = buildFindFirstTenantWhereForTests(
      { dealershipId: 'seed-dealership' },
      { dealershipId: 'seed-dealership' }
    );
    assert.deepEqual(where, { dealershipId: 'seed-dealership' });
    assert.equal('AND' in where, false);
  });

  it('does not treat Invalid prisma.auditLog.findMany as retriable outage', () => {
    const msg =
      "Invalid `prisma.auditLog.findMany()` invocation: Error occurred during query execution";
    assert.equal(isRetryableDbTransientError(new Error(msg)), false);

    const mapped = mapRouteError(new Error(msg), 'ros.create');
    assert.equal(mapped.status, 500);
    assert.match(mapped.message, /query failed|Database query failed/i);
    assert.doesNotMatch(mapped.message, /temporarily unavailable/i);
  });

  it('still treats SQLITE_BUSY as retriable 503', () => {
    assert.equal(isRetryableDbTransientError(new Error('SQLITE_BUSY: database is locked')), true);
    const mapped = mapRouteError(new Error('database is locked'), 'ros.create');
    assert.equal(mapped.status, 503);
    assert.match(mapped.message, /temporarily unavailable/i);
  });
});
