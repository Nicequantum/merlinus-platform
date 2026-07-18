import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { CUSTOMER_PAY_AUDIT_ACTIONS } from '@/lib/audit';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('High priority audit fixes (H1–H15)', () => {
  it('H1: shared isCustomerPayRepairLine helper', () => {
    assert.equal(isCustomerPayRepairLine({ isCustomerPay: true }), true);
    assert.equal(isCustomerPayRepairLine({ isCustomerPay: false }), false);
    assert.equal(isCustomerPayRepairLine({}), false);
    const storySrc = readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts');
    assert.ok(storySrc.includes('isCustomerPayRepairLine'));
  });

  it('H2: serialized save queue and awaitable debounce flush', () => {
    const queueSrc = readSrc('src/lib/repairOrderSaveQueue.ts');
    const debounceSrc = readSrc('src/lib/debounce.ts');
    const persistSrc = readSrc('src/hooks/repairOrders/useROPersistence.ts');
    const storySrc = readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts');
    assert.ok(queueSrc.includes('enqueueRepairOrderSave'));
    assert.ok(queueSrc.includes('getQueue')); // per-RO queues
    assert.ok(debounceSrc.includes('flush: () => Promise<void>'));
    assert.ok(persistSrc.includes('awaitRepairOrderSaveQueue'));
    assert.ok(storySrc.includes('await deps.flushPendingSave()'));
  });

  it('H3/H4: customer pay story audit actions', () => {
    assert.ok(CUSTOMER_PAY_AUDIT_ACTIONS.has('customerPayStory.edit'));
    assert.ok(CUSTOMER_PAY_AUDIT_ACTIONS.has('customerPayStory.pdf_export'));
    const putSrc = readSrc('src/app/api/repair-orders/[id]/route.ts');
    assert.ok(putSrc.includes("action: 'customerPayStory.edit'"));
    const latestSrc = readSrc('src/app/api/audit-logs/latest/route.ts');
    assert.ok(latestSrc.includes('customerPayTemplateApplied'));
    const pdfSrc = readSrc('src/app/api/audit-logs/pdf-export/route.ts');
    assert.ok(pdfSrc.includes("action: 'customerPayStory.pdf_export'"));
  });

  it('H5: audit chain still sequential on D1 (no Postgres advisory lock)', () => {
    const auditSrc = readSrc('src/lib/audit.ts');
    // Cloudflare D1/SQLite has no pg_advisory_xact_lock — hash chain uses previousHash.
    assert.equal(auditSrc.includes('pg_advisory_xact_lock'), false);
    assert.ok(auditSrc.includes('previousHash') || auditSrc.includes('entryHash'));
  });

  it('H6/H7: encryption loud decrypt and derived salt', () => {
    const encSrc = readSrc('src/lib/encryption.ts');
    assert.ok(encSrc.includes('encryption.decrypt_failed'));
    assert.ok(encSrc.includes('getScryptSalt'));
    assert.ok(!encSrc.includes("return scryptSync(secret, 'benz-tech-pii-salt', 32)"));
  });

  it('H8: production requires KV; dev keeps in-memory fallback', () => {
    const validateEnv = readSrc('scripts/validate-env.mjs');
    assert.ok(validateEnv.includes('PRODUCTION_REQUIRED'));
    assert.ok(validateEnv.includes('process.exit(1)'));
    const rateSrc = readSrc('src/lib/rate-limit.ts');
    assert.ok(rateSrc.includes('memoryRateLimitConfig'));
    assert.ok(rateSrc.includes('isProductionEnv'));
    assert.ok(rateSrc.includes('rate_limit.kv_fallback_memory'));
    assert.equal(rateSrc.includes("logger.warn('rate_limit.kv_fallback'"), false);
    assert.equal(rateSrc.includes('FAIL_CLOSED_ROUTE_KEYS'), false);
  });

  it('H9: image access uses targeted query with exact pathname verification', () => {
    const src = readSrc('src/lib/imageAccess.ts');
    // H9 — single-path targeted lookup (not full RO table scan)
    assert.ok(src.includes('repairOrderContainsPathname'));
    assert.ok(src.includes('contains: pathname') || src.includes("contains: pathname"));
    assert.ok(src.includes('findMany'));
    // Phase 7.1 H4 — batched multi-path scan for extract/attach
    assert.ok(src.includes('loadAttachedPathnames') || src.includes('pathnamesFromImageJson'));
    assert.ok(src.includes('findForbiddenImagePathname'));
  });

  it('H10: repair order list pagination', () => {
    const src = readSrc('src/app/api/repair-orders/route.ts');
    assert.ok(src.includes('nextCursor'));
    assert.ok(src.includes('hasMore'));
    assert.ok(readSrc('src/lib/roListQuery.ts').includes("'previous'"));
  });

  it('H16: repair order list uses summary DTO without full line decryption', () => {
    const listRoute = readSrc('src/app/api/repair-orders/route.ts');
    const mapper = readSrc('src/lib/roMapper.ts');
    assert.ok(listRoute.includes('dbToRepairOrderSummary'));
    assert.equal(listRoute.includes('dbToRepairOrder(ro)'), false);
    assert.ok(mapper.includes('hasWarrantyStory'));
    assert.ok(mapper.includes('firstComplaintPreview'));
  });

  it('H17: encryption keys split for AES and HMAC search', () => {
    const enc = readSrc('src/lib/encryption.ts');
    const search = readSrc('src/lib/piiSearchToken.ts');
    const env = readSrc('src/lib/env.ts');
    assert.ok(enc.includes('DATA_ENCRYPTION_KEY'));
    assert.equal(enc.includes('process.env.ENCRYPTION_KEY'), false);
    assert.ok(search.includes('SEARCH_HMAC_KEY'));
    assert.ok(env.includes('DATA_ENCRYPTION_KEY'));
    assert.ok(env.includes('SEARCH_HMAC_KEY'));
  });

  it('H11: no hardcoded changeme123 or password123 in seed sources', () => {
    const seedDb = readSrc('src/lib/seedDatabase.ts');
    const seedSec = readSrc('src/lib/seedSecurity.ts');
    assert.equal(seedDb.includes('changeme123'), false);
    assert.equal(seedSec.includes('changeme123'), false);
    assert.equal(seedDb.includes('password123'), false);
    assert.equal(seedSec.includes('password123'), false);
    assert.equal(seedSec.includes('DEFAULT_TECH_SEED_PASSWORD'), false);
    assert.ok(seedDb.includes('getCanonicalSeedPassword'));
    assert.ok(seedDb.includes('ensureCanonicalSeedAccount'));
    assert.ok(seedDb.includes('PRIMARY_MANAGER_D7'));
  });

  it('H12: noise monitor throttled to 4Hz', () => {
    const src = readSrc('src/lib/voice/noiseMonitor.ts');
    assert.ok(src.includes('EMIT_INTERVAL_MS = 250'));
  });

  it('H13: recognition start failure detaches manual edit guard', () => {
    const src = readSrc('src/lib/voice/VoiceInputService.ts');
    assert.ok(src.includes('if (!started)'));
    assert.ok(src.includes('detachManualEditGuard'));
  });

  it('H14: template apply requires isCustomerPay flag', () => {
    const src = readSrc('src/lib/customerPayTemplate.ts');
    assert.ok(src.includes('if (!template.isCustomerPay)'));
  });

  it('H15: build runs gated D1 migrate via migrate-deploy.mjs (Wrangler, not prisma migrate)', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: { build?: string; 'build:next'?: string; 'build:opennext'?: string; 'db:migrate:deploy'?: string };
    };
    const buildNext = pkg.scripts?.['build:next'] ?? '';
    const buildScript = pkg.scripts?.build ?? '';
    // build:next runs migrate-deploy + next; build chains OpenNext packaging for Wrangler
    assert.ok(buildNext.includes('migrate-deploy.mjs'));
    assert.ok(buildNext.includes('next build'));
    assert.ok(buildScript.includes('build:opennext') || buildScript.includes('opennext'));
    assert.ok(pkg.scripts?.['build:opennext']?.includes('opennextjs-cloudflare build'));
    assert.ok(pkg.scripts?.['db:migrate:deploy']?.includes('migrate-deploy.mjs'));
    const migrateScript = readSrc('scripts/migrate-deploy.mjs');
    // D1: wrangler d1 migrations — not prisma migrate deploy
    assert.ok(migrateScript.includes('wrangler d1') || migrateScript.includes('D1'));
    assert.equal(migrateScript.includes('npx prisma migrate deploy'), false);
  });
});