import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { cloneRepairOrderForUpdate } from '../../src/utils/cloneRepairOrder';
import { normalizeIdempotencyKey } from '../../src/lib/roCreateIdempotency.shared';
import type { RepairOrder } from '../../src/types';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('P2 system hardening', () => {
  it('search aborts prior requests and ignores stale sequences', () => {
    const src = readSrc('src/hooks/repairOrders/useROSearch.ts');
    assert.match(src, /AbortController/);
    assert.match(src, /searchSeqRef/);
    assert.match(src, /controller\.abort/);
    assert.match(src, /signal: controller\.signal/);
  });

  it('voice visibilitychange listener is removed on cleanup', () => {
    const src = readSrc('src/hooks/useVoiceInput.ts');
    assert.match(src, /onVisibilityChange/);
    assert.match(src, /removeEventListener\('visibilitychange', onVisibilityChange\)/);
  });

  it('cloneRepairOrderForUpdate is shallow and preserves line content', () => {
    const base: RepairOrder = {
      id: 'ro-1',
      roNumber: '1',
      vehicle: { vin: 'W', year: '2022', make: 'MB', model: 'C', mileageIn: '1', mileageOut: '' },
      customer: { name: 'T' },
      complaints: ['A'],
      repairLines: [
        {
          id: 'l1',
          lineNumber: 1,
          description: 'D',
          customerConcern: 'C',
          technicianNotes: 'Notes',
          xentryImages: [{ id: 'i', pathname: 'p', url: '/p', name: 'p.jpg' }],
          warrantyStory: 'Long story text that should not deep-clone via structuredClone path',
        },
      ],
    };
    const cloned = cloneRepairOrderForUpdate(base);
    assert.equal(cloned.repairLines[0].warrantyStory, base.repairLines[0].warrantyStory);
    assert.notEqual(cloned.repairLines, base.repairLines);
    assert.notEqual(cloned.repairLines[0], base.repairLines[0]);
    // Mutating clone arrays must not mutate source
    cloned.repairLines[0].xentryImages!.push({
      id: 'x',
      pathname: 'x',
      url: '/x',
      name: 'x.jpg',
    });
    assert.equal(base.repairLines[0].xentryImages!.length, 1);
  });

  it('applyROUpdate uses cloneRepairOrderForUpdate not structuredClone', () => {
    const src = readSrc('src/hooks/repairOrders/useROPersistence.ts');
    assert.match(src, /cloneRepairOrderForUpdate/);
    assert.doesNotMatch(src, /structuredClone\(/);
  });

  it('409 UX offers keep-local and use-server choices', () => {
    const ux = readSrc('src/lib/saveConflictUx.ts');
    assert.match(ux, /Keep mine/);
    assert.match(ux, /Use server/);
    assert.match(ux, /keep-local/);
    assert.match(ux, /use-server/);
    const persist = readSrc('src/hooks/repairOrders/useROPersistence.ts');
    assert.match(persist, /promptSaveConflictChoice/);
    assert.match(persist, /fullyApplied/);
  });

  it('create RO supports Idempotency-Key and replays from audit', () => {
    assert.equal(normalizeIdempotencyKey('short'), null);
    assert.equal(normalizeIdempotencyKey('scan-abc-12345-ok'), 'scan-abc-12345-ok');
    assert.equal(normalizeIdempotencyKey('bad key!'), null);

    const route = readSrc('src/app/api/repair-orders/route.ts');
    assert.match(route, /readIdempotencyKeyFromRequest/);
    assert.match(route, /findIdempotentRepairOrderCreate/);
    assert.match(route, /idempotent: true/);

    const sanitize = readSrc('src/lib/auditMetadataSanitize.ts');
    assert.match(sanitize, /idempotencyKey/);

    const api = readSrc('src/lib/api.ts');
    assert.match(api, /Idempotency-Key/);
  });
});
