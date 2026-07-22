import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  readRoListCache,
  writeRoListCache,
  clearRoListCache,
} from '@/lib/roListCache';
import {
  enqueueAiStoryJobIntent,
  listAiStoryJobIntents,
  removeAiStoryJobIntent,
  flushAiStoryJobIntents,
} from '@/lib/aiJobOfflineQueue';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

/** Minimal sessionStorage polyfill for node tests */
function installSessionStorage(): void {
  const map = new Map<string, string>();
  // @ts-expect-error test polyfill
  globalThis.sessionStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function installLocalStorage(): void {
  const map = new Map<string, string>();
  // @ts-expect-error test polyfill
  globalThis.localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe('Bay cold-start + offline polish', () => {
  beforeEach(() => {
    installSessionStorage();
    installLocalStorage();
    clearRoListCache();
  });

  afterEach(() => {
    clearRoListCache();
  });

  it('RO list cache roundtrip supports SWR first paint', () => {
    writeRoListCache({
      technicianId: 'tech1',
      dealershipId: 'd1',
      repairOrders: [
        {
          id: 'ro1',
          roNumber: '123',
          year: '2020',
          make: 'MB',
          model: 'C',
          repairLines: [],
        } as never,
      ],
      todayStart: new Date().toISOString(),
    });
    const hit = readRoListCache('tech1', 'd1');
    assert.ok(hit);
    assert.equal(hit!.payload.repairOrders.length, 1);
    assert.equal(hit!.payload.repairOrders[0]!.id, 'ro1');
    assert.equal(hit!.fresh, true);
  });

  it('AI story offline intent queue enqueue/list/remove/flush', async () => {
    const row = enqueueAiStoryJobIntent({
      roId: 'ro1',
      lineId: 'line1',
      technicianNotes: 'noise',
    });
    assert.equal(listAiStoryJobIntents().length, 1);
    removeAiStoryJobIntent(row.id);
    assert.equal(listAiStoryJobIntents().length, 0);

    enqueueAiStoryJobIntent({ roId: 'ro2', lineId: 'line2' });
    const result = await flushAiStoryJobIntents(async () => {
      /* success */
    });
    assert.equal(result.flushed, 1);
    assert.equal(listAiStoryJobIntents().length, 0);
  });

  it('session warmup warms RO path', () => {
    const src = readSrc('src/app/api/session/warmup/route.ts');
    assert.match(src, /repairOrder\.findFirst/);
    assert.match(src, /bayColdStartProbe/);
  });

  it('bay warmup + keep-alive + visibility hooks exist', () => {
    assert.match(readSrc('src/lib/bayWarmup.ts'), /runAggressiveBayWarmup/);
    assert.match(readSrc('src/lib/bayWarmup.ts'), /startVisibilityBayWarmup/);
    assert.match(readSrc('src/lib/clientFetchRetry.ts'), /aggressive/);
    assert.match(readSrc('src/lib/clientFetchRetry.ts'), /visibilitychange/);
    assert.match(readSrc('src/hooks/useBayPrefetch.ts'), /startBaySessionKeepAlive/);
  });

  it('login paths run aggressive bay warm', () => {
    assert.match(readSrc('src/lib/loginSession.ts'), /runAggressiveBayWarmup/);
    assert.match(readSrc('src/lib/apexLoginSession.ts'), /runAggressiveBayWarmup/);
  });

  it('tablet UX: pull-to-refresh, skeleton, AI progress banner', () => {
    assert.match(readSrc('src/components/PullToRefresh.tsx'), /Pull to refresh/);
    assert.match(readSrc('src/components/RoListSkeleton.tsx'), /Loading repair orders/);
    assert.match(readSrc('src/components/AiJobProgressBanner.tsx'), /AI Thinking/);
    assert.match(readSrc('src/components/HomeView.tsx'), /PullToRefresh/);
    assert.match(readSrc('src/app/globals.css'), /touch-target-bay/);
  });

  it('useROList hydrates from cache (SWR-style)', () => {
    assert.match(readSrc('src/hooks/repairOrders/useROList.ts'), /readRoListCache/);
    assert.match(readSrc('src/hooks/repairOrders/useROList.ts'), /writeRoListCache/);
    assert.match(readSrc('src/hooks/repairOrders/useROList.ts'), /isValidating/);
  });

  it('story workflow optimistic AI progress', () => {
    assert.match(readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts'), /optimisticProgress/);
    assert.match(readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts'), /Waiting for AI bay/);
  });

  it('video offline flush + health bay metrics', () => {
    assert.match(readSrc('src/lib/videoInspection/offlineQueue.ts'), /flushPendingUploadsWhenOnline/);
    assert.match(readSrc('src/lib/healthChecks.ts'), /checkBayMobileHealth/);
    assert.match(readSrc('src/lib/healthChecks.ts'), /bayMobile/);
  });
});
