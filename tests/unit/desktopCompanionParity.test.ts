import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildDesktopDeepLink,
  loadDesktopLayoutPrefs,
  parseDesktopDeepLink,
} from '@/lib/desktopLayoutPrefs';
import { deriveCompanionSyncRole } from '@/lib/companionSyncRole';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('Desktop companion parity + live sync', () => {
  it('desktop uses full sync role for bidirectional edits', () => {
    assert.equal(deriveCompanionSyncRole(true), 'full');
    assert.equal(deriveCompanionSyncRole(false), 'publisher');
  });

  it('parses and builds deep links for RO/line', () => {
    const href = buildDesktopDeepLink({
      origin: 'https://example.com',
      roId: 'ro1',
      lineId: 'ln1',
      view: 'line',
    });
    assert.ok(href.includes('ro=ro1'));
    assert.ok(href.includes('line=ln1'));
    assert.ok(href.includes('desktop=1'));
    const parsed = parseDesktopDeepLink('ro=ro1&line=ln1&view=line&desktop=1');
    assert.equal(parsed.roId, 'ro1');
    assert.equal(parsed.lineId, 'ln1');
    assert.equal(parsed.forceDesktop, true);
  });

  it('layout prefs have safe defaults', () => {
    const prefs = loadDesktopLayoutPrefs();
    assert.equal(typeof prefs.splitRoList, 'boolean');
    assert.ok(prefs.activityWidthPx >= 240);
  });

  it('shell and live badge exist', () => {
    assert.match(readSrc('src/components/desktop/DesktopCommandShell.tsx'), /LiveTechnicianSessionBadge/);
    assert.match(readSrc('src/components/desktop/LiveTechnicianSessionBadge.tsx'), /Live Technician Session/);
    assert.match(readSrc('src/hooks/useCompanionSync.ts'), /RO_SNAPSHOT_MS_LIVE/);
  });
});
