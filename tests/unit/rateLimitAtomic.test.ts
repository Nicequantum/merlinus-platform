import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicKvIncrement, RATE_LIMITS } from '@/lib/rate-limit';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('F-04 atomic KV rate limit', () => {
  it('source uses compare-and-swap atomic increment (not bare get-increment-put)', () => {
    const src = readSrc('src/lib/rate-limit.ts');
    assert.match(src, /export async function atomicKvIncrement/);
    assert.match(src, /writerId/);
    assert.match(src, /rate_limit_cas_exhausted/);
    assert.match(src, /withKvKeyGate/);
    // Must not use the old non-atomic single-path pattern as the only write
    assert.equal(src.includes('Not perfectly atomic under extreme concurrency'), false);
  });

  it('atomicKvIncrement serializes increments for a mock KV namespace', async () => {
    const store = new Map<string, string>();
    const ns = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    };

    const key = `ratelimit:test.atomic.${Date.now()}`;
    const counts: number[] = [];
    for (let i = 0; i < 5; i++) {
      counts.push(await atomicKvIncrement(ns, key, { limit: 100, windowMs: 60_000 }));
    }
    assert.deepEqual(counts, [1, 2, 3, 4, 5]);
  });

  it('atomicKvIncrement remains correct under concurrent isolate-style races', async () => {
    const store = new Map<string, string>();
    let delayPuts = false;
    const ns = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        if (delayPuts) {
          await new Promise((r) => setTimeout(r, 1 + Math.random() * 3));
        }
        store.set(key, value);
      },
    };

    const key = `ratelimit:test.race.${Date.now()}`;
    delayPuts = true;
    // Same-isolate gate serializes; still validates final count integrity
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        atomicKvIncrement(ns, key, { limit: 100, windowMs: 60_000 })
      )
    );
    delayPuts = false;

    assert.equal(results.length, 12);
    assert.equal(new Set(results).size, 12, 'each increment must observe a unique count');
    assert.equal(Math.max(...results), 12);
    assert.equal(Math.min(...results), 1);
  });

  it('preserves auth rate limit ceiling constants', () => {
    assert.equal(RATE_LIMITS.auth.limit, 10);
    assert.equal(RATE_LIMITS.auth.windowMs, 60_000);
  });
});
