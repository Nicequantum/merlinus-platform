import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  CAPABILITY_OVERRIDES,
  PILOT_STATUS_LEGEND,
  resolvePilotStatus,
} from '@/lib/capabilityMatrix/overrides';

const root = resolve(process.cwd());

describe('living capability matrix', () => {
  it('classifies core RO routes as pilot-core', () => {
    const r = resolvePilotStatus('src/app/api/repair-orders/route.ts', null);
    assert.equal(r.pilotStatus, 'pilot-core');
  });

  it('classifies owner billing as national-owner', () => {
    const r = resolvePilotStatus('src/app/api/owner/billing/route.ts', null);
    assert.equal(r.pilotStatus, 'national-owner');
  });

  it('classifies cdk as deferred', () => {
    const r = resolvePilotStatus('src/app/api/modules/cdk-status/route.ts', 'cdk_sync');
    assert.equal(r.pilotStatus, 'deferred');
  });

  it('has legend for every pilot status used in overrides', () => {
    for (const o of CAPABILITY_OVERRIDES) {
      assert.ok(PILOT_STATUS_LEGEND[o.pilotStatus], `missing legend for ${o.pilotStatus}`);
    }
  });

  it('generator script writes docs/generated matrix', () => {
    execSync('node scripts/generate-capability-matrix.mjs', {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    assert.ok(existsSync(resolve(root, 'docs/generated/capability-matrix.json')));
    assert.ok(existsSync(resolve(root, 'docs/generated/CAPABILITY-MATRIX.md')));
    const matrix = JSON.parse(
      readFileSync(resolve(root, 'docs/generated/capability-matrix.json'), 'utf8')
    );
    assert.ok(matrix.routeCount > 50, 'expected substantial API surface');
    assert.ok(Array.isArray(matrix.rows));
    assert.ok(matrix.rows.some((r: { pilotStatus: string }) => r.pilotStatus === 'pilot-core'));
  });

  it('package.json exposes matrix:generate and matrix:check', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts['matrix:generate']);
    assert.ok(pkg.scripts['matrix:check']);
  });
});
