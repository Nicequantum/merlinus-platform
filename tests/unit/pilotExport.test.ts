import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  PILOT_EXPORT_DATASETS,
  PILOT_EXPORT_SCHEMA_VERSION,
  DATASET_DESCRIPTIONS,
} from '@/lib/pilotExport/types';
import { encodeCursor, decodeCursor, clampLimit } from '@/lib/pilotExport/cursor';
import { hashEmail, maskIp } from '@/lib/pilotExport/redact';

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('pilot data export', () => {
  it('catalog is complete and described', () => {
    assert.equal(PILOT_EXPORT_SCHEMA_VERSION, '1.0.0');
    assert.ok(PILOT_EXPORT_DATASETS.length >= 14);
    for (const id of PILOT_EXPORT_DATASETS) {
      assert.ok(DATASET_DESCRIPTIONS[id], id);
      assert.ok(DATASET_DESCRIPTIONS[id].title);
    }
  });

  it('cursor round-trips', () => {
    const c = encodeCursor(new Date('2026-08-01T12:00:00.000Z'), 'abc123');
    const d = decodeCursor(c);
    assert.equal(d?.i, 'abc123');
    assert.ok(d?.t.includes('2026-08-01'));
    assert.equal(decodeCursor('not-valid'), null);
    assert.equal(clampLimit('999', 100, 500), 500);
    assert.equal(clampLimit('0', 100, 500), 100);
  });

  it('email hash is stable and non-reversible shape', () => {
    const a = hashEmail('Owner@Dealer.com');
    const b = hashEmail('owner@dealer.com');
    assert.equal(a, b);
    assert.equal(a.length, 24);
    assert.notEqual(a, 'owner@dealer.com');
  });

  it('ip mask hides host portion', () => {
    assert.equal(maskIp('10.20.30.40'), '10.20.30.0');
    assert.equal(maskIp(null), null);
  });

  it('routes dual-auth and intentional bare', () => {
    const rootRoute = read('src/app/api/export/pilot/route.ts');
    const dsRoute = read('src/app/api/export/pilot/[dataset]/route.ts');
    const policy = read('src/lib/apiRoutePolicy.ts');
    const auth = read('src/lib/pilotExport/auth.ts');
    assert.match(rootRoute, /authorizePilotExport/);
    assert.match(rootRoute, /pilot\.export/);
    assert.match(dsRoute, /runPilotExport/);
    assert.match(policy, /export\/pilot\/route\.ts/);
    assert.match(policy, /export\/pilot\/\[dataset\]/);
    assert.match(auth, /PILOT_EXPORT_TOKEN/);
    assert.match(auth, /timingSafeEqual/);
  });

  it('runExport never selects encrypted story/customer fields', () => {
    const run = read('src/lib/pilotExport/runExport.ts');
    assert.doesNotMatch(run, /warrantyStory|customerNameEncrypted|passwordHash|resultEncrypted|mfaSecret/);
    assert.match(run, /storyGenerated/);
    assert.match(run, /storyCertifiedAt/);
    assert.match(run, /hashEmail/);
  });

  it('docs and owner UI exist', () => {
    assert.match(read('docs/PILOT-DATA-EXPORT.md'), /PILOT_EXPORT_TOKEN/);
    assert.match(read('src/components/apex/OwnerPilotExportPanel.tsx'), /Load catalog/);
    assert.match(read('src/components/apex/ApexOwnerNationalShell.tsx'), /Data export/);
  });
});
