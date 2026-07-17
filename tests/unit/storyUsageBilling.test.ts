import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('story usage billing (first generate per line)', () => {
  it('event type constant is story_generated', () => {
    const src = readSrc('src/lib/storyUsageBilling.ts');
    assert.match(src, /STORY_GENERATED_EVENT_TYPE\s*=\s*'story_generated'/);
  });

  it('schema has story_generated flag and usage_events table', () => {
    const schema = readSrc('prisma/schema.prisma');
    assert.match(schema, /storyGenerated/);
    assert.match(schema, /@map\("story_generated"\)/);
    assert.match(schema, /model UsageEvent/);
    assert.match(schema, /@@map\("usage_events"\)/);
    assert.match(schema, /@@unique\(\[repairLineId, eventType\]\)/);
  });

  it('migration creates story_generated and usage_events', () => {
    const sql = readSrc(
      'prisma/migrations/20250718120000_story_generated_usage_events/migration.sql'
    );
    assert.match(sql, /story_generated/);
    assert.match(sql, /usage_events/);
    assert.match(sql, /event_type/);
  });

  it('billing helper is conditional on story_generated=false and unique race-safe', () => {
    const src = readSrc('src/lib/storyUsageBilling.ts');
    assert.match(src, /storyGenerated:\s*false/);
    assert.match(src, /storyGenerated:\s*true/);
    assert.match(src, /usageEvent\.create/);
    assert.match(src, /P2002/);
    assert.match(src, /STORY_GENERATED_EVENT_TYPE/);
  });

  it('generate-story route records usage only after persist in the same transaction', () => {
    const route = readSrc(
      'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts'
    );
    assert.match(route, /recordFirstStoryGeneratedUsage/);
    assert.match(route, /persistRepairLineStoryInTransaction/);
    // Billing only when non-empty story
    assert.match(route, /warrantyStory\.trim\(\)\.length > 0/);
    // Must sit inside rlsTransaction with persist
    const persistIdx = route.indexOf('persistRepairLineStoryInTransaction');
    const billingIdx = route.indexOf('recordFirstStoryGeneratedUsage');
    assert.ok(persistIdx > 0 && billingIdx > persistIdx, 'billing must run after persist');
  });

  it('does not wire billing into scan, OCR, xentry, or RO create paths', () => {
    const paths = [
      'src/app/api/repair-orders/extract/route.ts',
      'src/app/api/diagnostics/extract/route.ts',
      'src/app/api/repair-orders/route.ts',
      'src/hooks/repairOrders/useROScan.ts',
      'src/hooks/repairOrders/useROXentryScan.ts',
    ];
    for (const p of paths) {
      const src = readSrc(p);
      assert.equal(
        src.includes('recordFirstStoryGeneratedUsage'),
        false,
        `${p} must not import story usage billing`
      );
      assert.equal(src.includes('usageEvent'), false, `${p} must not write usage events`);
    }
  });

  it('customer-pay template path is not mixed into first-story AI billing helper usage', () => {
    const cp = readSrc('src/lib/customerPayTemplate.ts');
    assert.equal(cp.includes('recordFirstStoryGeneratedUsage'), false);
  });
});
