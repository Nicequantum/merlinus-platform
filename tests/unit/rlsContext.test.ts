import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  isRlsEnabled,
  rlsContextFromSession,
} from '../../src/lib/apex/rlsContext';
import { APEX_NATIONAL_DEALERSHIP_ID } from '../../src/lib/apex/platformConstants';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Phase 6.1/6.2 RLS context', () => {
  it('isRlsEnabled defaults enforce on Apex; soft-open on Merlinus', () => {
    const prevRls = process.env.RLS_ENABLED;
    const prevMode = process.env.PLATFORM_MODE;
    const prevPublic = process.env.NEXT_PUBLIC_PLATFORM_MODE;
    const prevApex = process.env.APEX_ENV;
    try {
      delete process.env.RLS_ENABLED;
      delete process.env.APEX_ENV;
      process.env.PLATFORM_MODE = 'merlinus';
      delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
      assert.equal(isRlsEnabled(), false);

      process.env.PLATFORM_MODE = 'apex';
      assert.equal(isRlsEnabled(), true);

      process.env.PLATFORM_MODE = 'merlinus';
      process.env.RLS_ENABLED = 'true';
      assert.equal(isRlsEnabled(), true);

      process.env.PLATFORM_MODE = 'apex';
      process.env.RLS_ENABLED = '0';
      // Apex ignores soft-open off
      assert.equal(isRlsEnabled(), true);
    } finally {
      if (prevRls === undefined) delete process.env.RLS_ENABLED;
      else process.env.RLS_ENABLED = prevRls;
      if (prevMode === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = prevMode;
      if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
      else process.env.NEXT_PUBLIC_PLATFORM_MODE = prevPublic;
      if (prevApex === undefined) delete process.env.APEX_ENV;
      else process.env.APEX_ENV = prevApex;
    }
  });

  it('rlsContextFromSession uses dealership scope for technicians', () => {
    const ctx = rlsContextFromSession({
      technicianId: 'tech-1',
      role: 'technician',
      dealershipId: 'seed-dealership',
      dealerId: 'dealer-1',
      scopeMode: 'dealership',
      activeDealershipId: 'seed-dealership',
    });
    assert.equal(ctx.scopeMode, 'dealership');
    assert.equal(ctx.activeDealershipId, 'seed-dealership');
    assert.equal(ctx.dealerId, 'dealer-1');
    assert.equal(ctx.technicianId, 'tech-1');
  });

  it('rlsContextFromSession clears active rooftop for national owners', () => {
    const prev = process.env.PLATFORM_MODE;
    process.env.PLATFORM_MODE = 'apex';
    try {
      const ctx = rlsContextFromSession({
        technicianId: 'owner-1',
        role: 'owner',
        dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
        dealerId: null,
        scopeMode: 'national',
        isOwner: true,
      });
      assert.equal(ctx.scopeMode, 'national');
      assert.equal(ctx.activeDealershipId, null);
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = prev;
    }
  });

  it('migration enables FORCE RLS on PII tables', () => {
    const sql = readSrc(
      'prisma/migrations/20250712120000_apex_phase6_1_rls_foundation/migration.sql'
    );
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /FORCE ROW LEVEL SECURITY/);
    assert.match(sql, /RepairOrder/);
    assert.match(sql, /RepairLine/);
    assert.match(sql, /AuditLog/);
    assert.match(sql, /app\.rls_enforced/);
    assert.match(sql, /app\.rls_bypass/);
  });

  it('Phase 6.2 migration is default-deny and covers Technician', () => {
    const sql = readSrc(
      'prisma/migrations/20250715120000_apex_phase6_2_rls_default_deny/migration.sql'
    );
    assert.match(sql, /app\.rls_soft_open/);
    assert.match(sql, /Technician/);
    assert.match(sql, /UsageLog/);
    assert.match(sql, /DealerGroupMembership/);
    assert.match(sql, /FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(
      sql,
      /COALESCE\(NULLIF\(current_setting\('app\.rls_enforced', true\), ''\), 'off'\) <> 'on'\s*\n\s*OR current_setting\('app\.rls_bypass'/
    );
  });

  it('rlsContext module exports setRlsContext and withRlsContext', () => {
    const src = readSrc('src/lib/apex/rlsContext.ts');
    assert.match(src, /export async function setRlsContext/);
    assert.match(src, /export async function withRlsContext/);
    assert.match(src, /export async function withRlsBypass/);
    assert.match(src, /isApexPlatformMode/);
    // D1: no live Postgres GUC calls — isolation via Prisma client extension.
    assert.equal(src.includes("$executeRaw`SELECT set_config"), false);
    assert.match(src, /getRlsDb/);
    assert.match(src, /createRlsEnforcedClient/);
    // Login uses withRlsBypass → withRlsContext. Interactive $transaction throws on PrismaD1.
    assert.doesNotMatch(src, /return prisma\.\$transaction\s*\(/);
    assert.match(src, /rlsStore\.run/);
  });
});
