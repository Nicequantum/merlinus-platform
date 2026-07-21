import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  evaluatePasswordPolicy,
  isElevatedPasswordRole,
  passwordPolicyIssue,
} from '@/lib/passwordPolicy';

const root = resolve(process.cwd());

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('P2-1 rollout runbook', () => {
  it('exists and is linked from README / docs index', () => {
    const runbook = readSrc('docs/Rollout-Runbook.md');
    assert.match(runbook, /Unified Rollout Runbook/);
    assert.match(runbook, /check:rls-registry/);
    assert.match(readSrc('README.md'), /Rollout-Runbook\.md/);
    assert.match(readSrc('docs/README.md'), /Rollout-Runbook\.md/);
  });
});

describe('P2-2 README badge honesty', () => {
  it('does not claim 99/100 enterprise audit', () => {
    const readme = readSrc('README.md');
    assert.doesNotMatch(readme, /99%2F100|99\/100/);
    assert.match(readme, /Pilot_readiness|Conditional/);
  });
});

describe('P2-3 instrumentation CF KV messaging', () => {
  it('references KV_STORE / Workers, not Vercel KV as primary', () => {
    const src = readSrc('src/instrumentation.ts');
    assert.match(src, /KV_STORE/);
    assert.match(src, /Workers KV|workers_kv/i);
    assert.doesNotMatch(src, /Connect Vercel KV \(Upstash\)/);
  });
});

describe('P2-4 observability sampling', () => {
  it('wrangler head_sampling_rate is reduced from full capture', () => {
    const toml = readSrc('wrangler.toml');
    assert.match(toml, /head_sampling_rate\s*=\s*0\.1/);
    assert.doesNotMatch(toml, /head_sampling_rate\s*=\s*1\b/);
  });
});

describe('P2-5 password policy', () => {
  it('elevated roles require 12+ and complexity', () => {
    assert.equal(isElevatedPasswordRole('manager'), true);
    assert.equal(isElevatedPasswordRole('technician'), false);

    const weak = evaluatePasswordPolicy('password1', { role: 'manager' });
    assert.equal(weak.ok, false);

    const short = evaluatePasswordPolicy('Ab1xxxxx', { role: 'manager' });
    assert.equal(short.ok, false); // 8 chars, needs 12

    const strong = evaluatePasswordPolicy('ManagerPass99x', { role: 'manager' });
    assert.equal(strong.ok, true, strong.errors.join('; '));

    const techOk = evaluatePasswordPolicy('techpass1', { role: 'technician' });
    assert.equal(techOk.ok, true);

    assert.ok(passwordPolicyIssue('password', { elevated: true }));
  });

  it('is wired into validation and change-password', () => {
    assert.match(readSrc('src/lib/validation.ts'), /passwordPolicyIssue/);
    assert.match(readSrc('src/lib/validation.ts'), /assertPasswordMeetsPolicy/);
    assert.match(readSrc('src/app/api/auth/change-password/route.ts'), /assertPasswordMeetsPolicy/);
  });
});

describe('P2-6 department MODULE_DISABLED consistency', () => {
  it('moduleGate returns MODULE_DISABLED code and JSON helper', () => {
    const gate = readSrc('src/lib/department/moduleGate.ts');
    assert.match(gate, /MODULE_DISABLED/);
    assert.match(gate, /departmentModuleDisabledResponse/);
    assert.match(gate, /ModuleDisabledError/);
  });

  it('department routes use departmentModuleDisabledResponse', () => {
    for (const rel of [
      'src/app/api/department-requests/route.ts',
      'src/app/api/department-requests/[id]/route.ts',
      'src/app/api/department-requests/[id]/parts-lines/route.ts',
      'src/app/api/department-requests/[id]/lookups/route.ts',
    ]) {
      assert.match(readSrc(rel), /departmentModuleDisabledResponse/, rel);
    }
  });
});
