import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { hashRoNumberForAudit, sanitizeAuditMetadata } from '@/lib/auditMetadataSanitize';
import { isAuthRateLimitRoute, RATE_LIMITS } from '@/lib/rate-limit';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('Phase 6.3 medium security hardening', () => {
  it('apiRoute auto-requires dealership context for manager/admin', () => {
    const src = readSrc('src/lib/apiRoute.ts');
    assert.match(src, /requireManager === true/);
    assert.match(src, /requireAdmin === true/);
    assert.match(src, /needsDealershipContext/);
  });

  it('manager user routes use getRlsDb', () => {
    assert.match(readSrc('src/app/api/users/route.ts'), /getRlsDb/);
    assert.match(readSrc('src/app/api/users/[id]/route.ts'), /getRlsDb/);
    assert.match(readSrc('src/app/api/users/[id]/password/route.ts'), /getRlsDb/);
    assert.match(readSrc('src/app/api/advisors/summary/route.ts'), /getRlsDb/);
    assert.match(readSrc('src/app/api/technicians/[id]/route.ts'), /getRlsDb/);
  });

  it('RO list uses fail-closed ro.list audit', () => {
    const src = readSrc('src/app/api/repair-orders/route.ts');
    assert.match(src, /action:\s*'ro\.list'/);
    assert.match(src, /requireAuditedAccess:\s*true/);
    assert.match(src, /resultCount/);
    assert.match(src, /entityType:\s*'repair_order_list'/);
    // List audit must not include plaintext RO numbers in metadata.
    const listBlock = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    assert.doesNotMatch(listBlock, /roNumber:\s*readRoNumberFromDb/);
    const audit = readSrc('src/lib/audit.ts');
    assert.match(audit, /'ro\.list'/);
    assert.match(audit, /CRITICAL_AUDIT_ACTIONS[\s\S]*'ro\.list'/);
  });

  it('audit metadata hashes RO numbers and drops unknown keys', () => {
    const a = hashRoNumberForAudit('ro-1');
    const b = hashRoNumberForAudit('RO-1');
    assert.equal(a, b);
    assert.equal(a.length, 32);
    const sanitized = sanitizeAuditMetadata({
      roNumber: 'W1234567',
      mysteryField: 'leak',
      resultCount: 3,
    });
    assert.equal(sanitized.roNumberHash, hashRoNumberForAudit('W1234567'));
    assert.equal('mysteryField' in sanitized, false);
    assert.equal(sanitized.resultCount, 3);
  });

  it('auth rate limits flag production KV requirement', () => {
    const src = readSrc('src/lib/rate-limit.ts');
    assert.match(src, /isAuthRateLimitRoute/);
    assert.match(src, /auth_kv_required/);
    // Auth routes fail closed when KV_STORE is configured but unavailable (Workers KV).
    assert.match(src, /auth_kv_unavailable_fail_closed|auth_kv_unavailable_fallback/);
    assert.match(src, /apex_kv_required/);
    // Apex: missing KV → 503; non-auth can still fall back to memory when store is down.
    assert.match(src, /apex_kv_unavailable_fallback/);
    assert.match(src, /apexProductionRequiresKv/);
    assert.match(src, /KV_STORE/);
    assert.equal(isAuthRateLimitRoute('auth.login'), true);
    assert.equal(isAuthRateLimitRoute('ros.list'), false);
  });

  it('companion routes are rate-limited', () => {
    assert.ok(RATE_LIMITS.companion.limit > 0);
    assert.ok(RATE_LIMITS.companionPublish.limit > 0);
    for (const file of [
      'src/app/api/companion/publish/route.ts',
      'src/app/api/companion/poll/route.ts',
      'src/app/api/companion/stream/route.ts',
    ]) {
      const src = readSrc(file);
      assert.doesNotMatch(src, /skipRateLimit:\s*true/);
      assert.match(src, /RATE_LIMITS\.companion/);
      assert.match(src, /requireDealershipContext:\s*true/);
    }
  });
});
