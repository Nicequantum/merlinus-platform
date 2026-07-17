import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  awaitRepairOrderSaveQueue,
  enqueueRepairOrderSave,
  isRepairOrderSaveQueueBusy,
} from '../../src/lib/repairOrderSaveQueue';
import { isLightLinePatch } from '../../src/hooks/repairOrders/useROPersistence';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('final wave hardening', () => {
  it('save queue is per-RO so concurrent ROs do not block each other', async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });

    const pA = enqueueRepairOrderSave('ro-a', async () => {
      order.push('a-start');
      await gateA;
      order.push('a-end');
      return 1;
    });
    const pB = enqueueRepairOrderSave('ro-b', async () => {
      order.push('b-done');
      return 2;
    });

    // B should complete while A is still gated
    await pB;
    assert.ok(order.includes('b-done'));
    assert.ok(order.includes('a-start'));
    assert.equal(order.includes('a-end'), false);
    assert.equal(isRepairOrderSaveQueueBusy('ro-a'), true);
    assert.equal(isRepairOrderSaveQueueBusy('ro-b'), false);

    releaseA();
    await pA;
    await awaitRepairOrderSaveQueue();
    assert.equal(isRepairOrderSaveQueueBusy(), false);
  });

  it('light line patch detection only allows text fields', () => {
    assert.equal(isLightLinePatch({ technicianNotes: 'x' }), true);
    assert.equal(isLightLinePatch({ warrantyStory: 's', technicianNotes: 'n' }), true);
    assert.equal(isLightLinePatch({ xentryImages: [] }), false);
    assert.equal(isLightLinePatch({}), false);
  });

  it('PATCH line route exists and full PUT batches line writes', () => {
    const patch = readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/route.ts');
    assert.match(patch, /export async function PATCH/);
    assert.match(patch, /encryptSensitiveText/);
    assert.match(patch, /updatedAt/);

    const put = readSrc('src/app/api/repair-orders/[id]/route.ts');
    assert.match(put, /Promise\.all\(/);
    assert.match(put, /data\.repairLines\.map\(async \(line\)/);

    const api = readSrc('src/lib/api.ts');
    assert.match(api, /patchRepairLine/);
  });

  it('updateLine uses light linePatch path for notes/story', () => {
    const src = readSrc('src/hooks/useRepairOrders.ts');
    assert.match(src, /linePatch:\s*\{\s*lineId,\s*fields:\s*nextUpdates/);
  });

  it('dead useSession hook is removed; loginSession is the client auth source', () => {
    assert.throws(() => readSrc('src/hooks/useSession.ts'));
    const login = readSrc('src/lib/loginSession.ts');
    assert.match(login, /probeCurrentSession/);
    assert.match(login, /loginWithCredentials/);
    assert.match(login, /acceptConsentSession/);
  });
});
