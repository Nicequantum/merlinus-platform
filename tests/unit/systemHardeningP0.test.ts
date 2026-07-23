import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { mergePersistedWithClient } from '../../src/lib/repairOrderMerge';
import type { RepairOrder } from '../../src/types';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

const baseRo = (): RepairOrder => ({
  id: 'ro-1',
  roNumber: '100',
  vehicle: { vin: 'W1N', year: '2022', make: 'MB', model: 'C', mileageIn: '1', mileageOut: '' },
  customer: { name: 'Test' },
  complaints: ['Noise'],
  updatedAt: '2026-01-01T00:00:00.000Z',
  repairLines: [
    {
      id: 'line-1',
      lineNumber: 1,
      description: 'Diag',
      customerConcern: 'Noise',
      technicianNotes: 'Found code',
      xentryImages: [],
      warrantyStory: 'Old story from server.',
    },
  ],
});

describe('P0 system hardening — save merge', () => {
  it('keeps newer client warranty story over stale server response', () => {
    const server = baseRo();
    const client = baseRo();
    client.repairLines[0].warrantyStory = 'Brand new generated story with details.';
    client.repairLines[0].technicianNotes = 'Found code\n\n[Audit enhancement] voltage';
    const merged = mergePersistedWithClient(server, client);
    assert.equal(merged.repairLines[0].warrantyStory, 'Brand new generated story with details.');
    assert.match(merged.repairLines[0].technicianNotes, /Audit enhancement/);
    assert.equal(merged.updatedAt, server.updatedAt);
  });

  it('keeps client xentry photos when server has fewer', () => {
    const server = baseRo();
    server.repairLines[0].xentryImages = [
      { id: 'a', pathname: 'p/a.jpg', url: '/a', name: 'a.jpg' },
    ];
    const client = baseRo();
    client.repairLines[0].xentryImages = [
      { id: 'a', pathname: 'p/a.jpg', url: '/a', name: 'a.jpg' },
      { id: 'b', pathname: 'p/b.jpg', url: '/b', name: 'b.jpg' },
    ];
    const merged = mergePersistedWithClient(server, client);
    assert.equal(merged.repairLines[0].xentryImages?.length, 2);
  });
});

describe('P0 system hardening — API retries', () => {
  it('disables retries on AI and create POSTs', () => {
    const api = readSrc('src/lib/api.ts');
    assert.match(api, /generateStory:[\s\S]*?maxRetries:\s*0/);
    assert.match(api, /certifyStory:[\s\S]*?maxRetries:\s*0/);
    assert.match(api, /createRepairOrder:[\s\S]*?maxRetries:\s*0/);
    assert.match(api, /extractDiagnostics:[\s\S]*?maxRetries:\s*0/);
    assert.match(api, /updateRepairOrder:[\s\S]*?maxRetries:\s*0/);
  });
});

describe('P0 system hardening — companion + 409', () => {
  it('skips companion snapshot when locally dirty', () => {
    const src = readSrc('src/hooks/useRepairOrders.ts');
    assert.match(src, /isLocallyDirty\(\)/);
    assert.match(src, /mergePersistedWithClient/);
  });

  it('resolves 409 with fetch + merge + retry', () => {
    const src = readSrc('src/hooks/repairOrders/useROPersistence.ts');
    assert.match(src, /resolveConflictAndRetry/);
    assert.match(src, /status === 409/);
    assert.match(src, /mergePersistedWithClient/);
  });
});

describe('P1 system hardening — session / list / xentry / poll', () => {
  it('session probe distinguishes timeout from unauthorized', () => {
    const src = readSrc('src/lib/loginSession.ts');
    assert.match(src, /probeCurrentSession/);
    assert.match(src, /status: 'timeout'/);
    assert.match(src, /status: 'unauthorized'/);
  });

  it('Merlinus login applies session body immediately', () => {
    const src = readSrc('src/components/BenzTechApp.tsx');
    assert.match(src, /loginWithCredentials/);
    // LoginResult may be union (success | mfa); apply session payload from success branch
    assert.match(src, /applySession\(fromLogin(\.session)?\)/);
    assert.match(src, /holdAuthenticatedRef/);
  });

  it('RO list uses slim select without full line payloads', () => {
    const src = readSrc('src/app/api/repair-orders/route.ts');
    assert.match(src, /warrantyStoryEncrypted: true/);
    assert.match(src, /Slim select/);
    assert.match(src, /select:\s*\{[\s\S]*repairLines:\s*\{[\s\S]*select:/);
  });

  it('Xentry analysis uses limited concurrency', () => {
    const src = readSrc('src/hooks/repairOrders/useROXentryScan.ts');
    assert.match(src, /XENTRY_ANALYSIS_CONCURRENCY\s*=\s*2/);
    assert.match(src, /Promise\.all\(workers\)/);
  });

  it('companion poll backs off when SSE connected and snapshot interval is slower', () => {
    const src = readSrc('src/hooks/useCompanionSync.ts');
    assert.match(src, /POLL_MS_CONNECTED/);
    // Live bay vs idle desktop snapshot intervals (v4.1 dual-speed mirror)
    assert.match(src, /RO_SNAPSHOT_MS_IDLE\s*=\s*8_000/);
    assert.match(src, /RO_SNAPSHOT_MS_LIVE\s*=\s*3_500/);
  });

  it('flushPendingSave defaults to a max wait', () => {
    const src = readSrc('src/hooks/repairOrders/useROPersistence.ts');
    assert.match(src, /DEFAULT_FLUSH_MAX_WAIT_MS/);
  });
});
