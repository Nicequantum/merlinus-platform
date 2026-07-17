import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canAccessNationalConsole,
  enrichSessionWithTenantScope,
  requireOwnerNationalScope,
  resolveSessionScopeMode,
} from '@/lib/apex/tenantScope';
import type { SessionPayload } from '@/lib/auth';

const root = resolve(process.cwd());

function ownerSession(scopeMode: 'national' | 'group' | 'dealership'): SessionPayload {
  return {
    technicianId: 'owner-1',
    d7Number: null,
    name: 'James Gray',
    role: 'owner',
    isAdmin: true,
    dealershipId: '__apex_national__',
    dealershipName: 'Viti Automotive Group',
    dealerId: null,
    serviceAdvisorId: null,
    consentAt: null,
    consentVersion: null,
    legalDisclaimerAt: null,
    legalDisclaimerVersion: null,
    sessionVersion: 0,
    scopeMode,
    isOwner: true,
    activeDealerGroupId: scopeMode === 'group' ? 'dealer-group-viti-auto' : undefined,
    dealerGroupName: scopeMode === 'group' ? 'Viti Automotive Group' : undefined,
  };
}

describe('PR-G2 group-scoped owner session', () => {
  it('resolveSessionScopeMode honors group', () => {
    const prev = process.env.PLATFORM_MODE;
    process.env.PLATFORM_MODE = 'apex';
    try {
      assert.equal(resolveSessionScopeMode(ownerSession('group')), 'group');
      assert.equal(resolveSessionScopeMode(ownerSession('national')), 'national');
      assert.equal(resolveSessionScopeMode(ownerSession('dealership')), 'dealership');
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = prev;
    }
  });

  it('group owners can access owner console (not PII)', () => {
    const prev = process.env.PLATFORM_MODE;
    process.env.PLATFORM_MODE = 'apex';
    try {
      assert.equal(canAccessNationalConsole(ownerSession('group')), true);
      assert.equal(canAccessNationalConsole(ownerSession('national')), true);
      assert.equal(canAccessNationalConsole(ownerSession('dealership')), false);
      assert.doesNotThrow(() => requireOwnerNationalScope(ownerSession('group')));
      assert.throws(() => requireOwnerNationalScope(ownerSession('dealership')));
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = prev;
    }
  });

  it('enrichSessionWithTenantScope preserves group fields', () => {
    const prev = process.env.PLATFORM_MODE;
    process.env.PLATFORM_MODE = 'apex';
    try {
      const enriched = enrichSessionWithTenantScope(ownerSession('group'));
      assert.equal(enriched.scopeMode, 'group');
      assert.equal(enriched.isOwner, true);
      assert.equal(enriched.activeDealershipId, undefined);
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = prev;
    }
  });

  it('routes and access helpers enforce group filtering', () => {
    const dealerships = readFileSync(
      resolve(root, 'src/app/api/owner/dealerships/route.ts'),
      'utf8'
    );
    assert.match(dealerships, /listEnterableDealershipsForOwner/);

    const enter = readFileSync(resolve(root, 'src/app/api/auth/enter-dealership/route.ts'), 'utf8');
    assert.match(enter, /ownerMayEnterDealership/);

    const exit = readFileSync(resolve(root, 'src/app/api/auth/exit-dealership/route.ts'), 'utf8');
    assert.match(exit, /buildOwnerHomeSession/);

    const login = readFileSync(resolve(root, 'src/lib/apex/loginResolver.ts'), 'utf8');
    assert.match(login, /buildOwnerHomeSession/);

    const access = readFileSync(resolve(root, 'src/lib/apex/dealerGroupAccess.ts'), 'utf8');
    assert.match(access, /listEnterableDealershipsForOwner/);
    assert.match(access, /ownerMayEnterDealership/);
    assert.match(access, /isPlatformOperator/);
    assert.doesNotMatch(access, /no memberships\): all/);

    const session = readFileSync(resolve(root, 'src/lib/apex/ownerDealershipContext.ts'), 'utf8');
    assert.match(session, /ownerMayEnterDealership/);

    const platform = readFileSync(resolve(root, 'src/lib/apex/platformOperator.ts'), 'utf8');
    assert.match(platform, /APEX_PLATFORM_OWNER_EMAILS/);
    assert.match(platform, /isPlatformOperator/);
  });
});
