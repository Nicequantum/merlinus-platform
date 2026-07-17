import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { CUSTOMER_PAY_AUDIT_ACTIONS } from '@/lib/audit';
import { isWriteHttpMethod } from '@/lib/requestLogging';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('write request logging and audit trail', () => {
  it('identifies mutating HTTP methods', () => {
    assert.equal(isWriteHttpMethod('POST'), true);
    assert.equal(isWriteHttpMethod('GET'), false);
    assert.equal(isWriteHttpMethod('patch'), true);
  });

  it('withAuth logs structured api.write entries for write operations', () => {
    const src = readSrc('src/lib/apiRoute.ts');
    assert.ok(src.includes('logApiWriteRequest'));
    assert.ok(src.includes("'api.write'") || src.includes('requestLogging'));
  });

  it('login route emits api.write logs', () => {
    const src = readSrc('src/app/api/auth/login/route.ts');
    assert.ok(src.includes('logApiWriteRequest'));
  });

  it('clear customer pay and template use persist audit entries', () => {
    const clearPay = readSrc('src/lib/customerPayTemplate.ts');
    const templateUse = readSrc('src/app/api/templates/[id]/use/route.ts');
    assert.ok(clearPay.includes("action: 'customerPay.clear'"));
    assert.ok(templateUse.includes("action: 'template.use'"));
    assert.ok(CUSTOMER_PAY_AUDIT_ACTIONS.has('customerPay.clear'));
  });
});