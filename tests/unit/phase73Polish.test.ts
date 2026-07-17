import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  getStartOfDealershipDay,
  isValidIanaTimezone,
  resolveDealershipTimezone,
  DEFAULT_DEALERSHIP_TIMEZONE,
} from '@/lib/dealershipDayBoundary';

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('Phase 7.3 — timezone (H7)', () => {
  test('resolves IANA timezones with fallbacks', () => {
    assert.equal(isValidIanaTimezone('America/Los_Angeles'), true);
    assert.equal(isValidIanaTimezone('not-a-zone'), false);
    assert.equal(resolveDealershipTimezone('America/Chicago'), 'America/Chicago');
    assert.equal(resolveDealershipTimezone(null, 'America/Denver'), 'America/Denver');
    assert.equal(resolveDealershipTimezone('bogus'), DEFAULT_DEALERSHIP_TIMEZONE);
  });

  test('getStartOfDealershipDay differs by timezone', () => {
    const ref = new Date('2026-03-15T18:00:00.000Z');
    const ny = getStartOfDealershipDay(ref, 'America/New_York');
    const la = getStartOfDealershipDay(ref, 'America/Los_Angeles');
    // Same calendar intent can still land on different UTC instants across zones
    assert.ok(ny instanceof Date && la instanceof Date);
    assert.notEqual(ny.getTime(), la.getTime());
  });

  test('schema and migration include dealership timezone + indexes', () => {
    const schema = readSrc('prisma/schema.prisma');
    assert.match(schema, /timezone\s+String/);
    assert.match(schema, /dealershipId, action, createdAt/);
    assert.match(schema, /dealershipId, isActive, deletedAt/);

    const mig = readSrc(
      'prisma/migrations/20250716120000_apex_phase7_3_timezone_indexes/migration.sql'
    );
    assert.match(mig, /Dealership.*timezone/s);
    assert.match(mig, /AuditLog_dealershipId_action_createdAt/);
  });

  test('session and usage paths honor dealershipTimezone', () => {
    assert.match(readSrc('src/lib/auth.ts'), /dealershipTimezone/);
    assert.match(readSrc('src/lib/usageMonitoring.ts'), /resolveDealershipTimezone|timeZone/);
    assert.match(readSrc('src/lib/roListQuery.ts'), /dealershipTimezone/);
    assert.match(readSrc('src/lib/apiRoute.ts'), /session\.dealershipTimezone/);
  });
});

describe('Phase 7.3 — story AI DRY (H14)', () => {
  test('withStoryAiRoute sets blockServiceAdvisorAi', () => {
    const shell = readSrc('src/lib/storyAiRoute.ts');
    assert.match(shell, /blockServiceAdvisorAi:\s*true/);
    assert.match(shell, /loadStoryRouteRepairOrder/);
    assert.match(shell, /rejectCustomerPay/);
  });

  test('story mutation routes use shell or withAuth blockServiceAdvisorAi', () => {
    for (const path of [
      'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts',
      'src/app/api/repair-orders/[id]/lines/[lineId]/score-story/route.ts',
      'src/app/api/repair-orders/[id]/lines/[lineId]/review-story/route.ts',
      'src/app/api/repair-orders/[id]/lines/[lineId]/certify-story/route.ts',
    ]) {
      assert.match(readSrc(path), /withStoryAiRoute/, path);
    }
    assert.match(readSrc('src/app/api/repair-orders/extract/route.ts'), /blockServiceAdvisorAi:\s*true/);
    assert.match(readSrc('src/app/api/diagnostics/extract/route.ts'), /blockServiceAdvisorAi:\s*true/);
    assert.match(
      readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/apply-customer-pay-template/route.ts'),
      /blockServiceAdvisorAi:\s*true/
    );
  });
});

describe('Phase 7.3 — multi-group switcher', () => {
  test('owner dealer-groups API and select route exist', () => {
    assert.match(readSrc('src/app/api/owner/dealer-groups/route.ts'), /listOwnerDealerGroupMemberships/);
    assert.match(readSrc('src/app/api/owner/select-dealer-group/route.ts'), /buildOwnerGroupSession/);
    assert.match(readSrc('src/app/api/owner/select-dealer-group/route.ts'), /revokeApexRefreshForScopeSwitch/);
  });

  test('UI wires portfolio select for multi-group owners', () => {
    const shell = readSrc('src/components/apex/ApexOwnerNationalShell.tsx');
    assert.match(shell, /fetchOwnerDealerGroups/);
    assert.match(shell, /selectOwnerDealerGroup/);
    assert.match(shell, /apex-group-switcher/);
    assert.match(readSrc('src/lib/apexLoginSession.ts'), /selectOwnerDealerGroup/);
  });
});
