import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  canAccessDealershipPii,
  canAccessNationalConsole,
  DealershipScopeRequiredError,
  enrichSessionWithTenantScope,
  requireDealershipScope,
  resolveSessionScopeMode,
  scopedPiiWhere,
} from '../../src/lib/apex/tenantScope';
import type { SessionPayload } from '../../src/lib/auth';

const baseSession: SessionPayload = {
  technicianId: 'tech-1',
  d7Number: 'D7123456',
  name: 'Tech',
  role: 'technician',
  isAdmin: false,
  dealershipId: 'dealer-ship-1',
  dealershipName: 'Test Dealer',
  dealerId: null,
  serviceAdvisorId: null,
  consentAt: null,
  consentVersion: null,
  legalDisclaimerAt: null,
  legalDisclaimerVersion: null,
  sessionVersion: 1,
};

describe('tenantScope (Phase 5.5)', () => {
  const savedPlatformMode = process.env.PLATFORM_MODE;
  const savedPublicPlatformMode = process.env.NEXT_PUBLIC_PLATFORM_MODE;
  const savedApexEnv = process.env.APEX_ENV;

  function restorePlatformEnv() {
    if (savedPlatformMode === undefined) delete process.env.PLATFORM_MODE;
    else process.env.PLATFORM_MODE = savedPlatformMode;
    if (savedPublicPlatformMode === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
    else process.env.NEXT_PUBLIC_PLATFORM_MODE = savedPublicPlatformMode;
    if (savedApexEnv === undefined) delete process.env.APEX_ENV;
    else process.env.APEX_ENV = savedApexEnv;
  }

  afterEach(() => {
    restorePlatformEnv();
  });

  test('merlinus mode always resolves dealership scope', () => {
    delete process.env.PLATFORM_MODE;
    delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
    delete process.env.APEX_ENV;
    const ownerNational: SessionPayload = {
      ...baseSession,
      role: 'owner',
      scopeMode: 'national',
      isOwner: true,
    };
    assert.equal(resolveSessionScopeMode(ownerNational), 'dealership');
    assert.equal(canAccessDealershipPii(ownerNational), true);
    assert.equal(canAccessNationalConsole(ownerNational), false);
  });

  test('apex owner defaults to national with no PII access', () => {
    process.env.PLATFORM_MODE = 'apex';
    const owner: SessionPayload = enrichSessionWithTenantScope({
      ...baseSession,
      role: 'owner',
      dealershipId: '__apex_national__',
      dealershipName: 'Apex National Platform',
    });
    assert.equal(owner.scopeMode, 'national');
    assert.equal(owner.isOwner, true);
    assert.equal(canAccessDealershipPii(owner), false);
    assert.equal(canAccessNationalConsole(owner), true);
    assert.throws(() => requireDealershipScope(owner), DealershipScopeRequiredError);
  });

  test('apex owner in dealership scope uses active rooftop for PII', () => {
    process.env.PLATFORM_MODE = 'apex';
    const owner: SessionPayload = enrichSessionWithTenantScope({
      ...baseSession,
      role: 'owner',
      scopeMode: 'dealership',
      activeDealershipId: 'rooftop-42',
      dealershipId: '__apex_national__',
      dealerId: 'dealer-x',
    });
    const scope = requireDealershipScope(owner);
    assert.equal(scope.dealershipId, 'rooftop-42');
    assert.deepEqual(scopedPiiWhere(owner), {
      dealershipId: 'rooftop-42',
      dealerId: 'dealer-x',
    });
    assert.equal(canAccessDealershipPii(owner), true);
    assert.equal(canAccessNationalConsole(owner), false);
  });

  test('apex technician always has dealership scope', () => {
    process.env.PLATFORM_MODE = 'apex';
    const tech = enrichSessionWithTenantScope(baseSession);
    assert.equal(tech.scopeMode, 'dealership');
    assert.equal(tech.isOwner, false);
    assert.equal(canAccessDealershipPii(tech), true);
  });
});