import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { isHourInWindow, getMaintenanceWindowSnapshot } from '@/lib/selfHeal/maintenanceWindow';
import { isGrokSelfHealEnabled } from '@/lib/selfHeal/config';

const root = resolve(process.cwd());

describe('self-heal + nightly maintenance', () => {
  it('window wraps midnight (20–6)', () => {
    assert.equal(isHourInWindow(20, 20, 6), true);
    assert.equal(isHourInWindow(23, 20, 6), true);
    assert.equal(isHourInWindow(0, 20, 6), true);
    assert.equal(isHourInWindow(5, 20, 6), true);
    assert.equal(isHourInWindow(6, 20, 6), false);
    assert.equal(isHourInWindow(12, 20, 6), false);
    assert.equal(isHourInWindow(19, 20, 6), false);
  });

  it('zero-width window is disabled', () => {
    assert.equal(isHourInWindow(10, 8, 8), false);
  });

  it('snapshot exposes timezone fields', () => {
    const snap = getMaintenanceWindowSnapshot(new Date('2026-07-31T12:00:00Z'));
    assert.ok(typeof snap.localHour === 'number');
    assert.ok(snap.timezone);
    assert.ok(typeof snap.inWindow === 'boolean');
  });

  it('GROK_SELF_HEAL_ENABLED reads truthy true', () => {
    const prev = process.env.GROK_SELF_HEAL_ENABLED;
    process.env.GROK_SELF_HEAL_ENABLED = 'true';
    assert.equal(isGrokSelfHealEnabled(), true);
    process.env.GROK_SELF_HEAL_ENABLED = '0';
    assert.equal(isGrokSelfHealEnabled(), false);
    if (prev === undefined) delete process.env.GROK_SELF_HEAL_ENABLED;
    else process.env.GROK_SELF_HEAL_ENABLED = prev;
  });

  it('ops routes exist and nightly is intentional bare', () => {
    const nightly = readFileSync(
      resolve(root, 'src/app/api/ops/nightly-maintenance/route.ts'),
      'utf8'
    );
    const selfHeal = readFileSync(resolve(root, 'src/app/api/ops/self-heal/route.ts'), 'utf8');
    const policy = readFileSync(resolve(root, 'src/lib/apiRoutePolicy.ts'), 'utf8');
    assert.match(nightly, /isOpsCronAuthorized/);
    assert.match(nightly, /runOpsMaintenance/);
    assert.match(selfHeal, /requireManager:\s*true/);
    assert.match(policy, /ops\/nightly-maintenance\/route\.ts/);
  });

  it('analysis path never mutates code (recommend-only contract)', () => {
    const analyze = readFileSync(
      resolve(root, 'src/lib/selfHeal/analyzeWithGrok.ts'),
      'utf8'
    );
    assert.match(analyze, /Never invent secrets/);
    assert.doesNotMatch(analyze, /writeFileSync|fs\.write|git commit/);
    const run = readFileSync(resolve(root, 'src/lib/selfHeal/runMaintenance.ts'), 'utf8');
    assert.match(run, /recommendations only|analyzeHealthWithGrok|selfHealEnabled/i);
  });

  it('ops-cron worker ships dual crons', () => {
    const wr = readFileSync(resolve(root, 'workers/ops-cron/wrangler.toml'), 'utf8');
    assert.match(wr, /crons/);
    assert.match(wr, /20 0/);
    assert.match(wr, /5 10/);
  });
});
