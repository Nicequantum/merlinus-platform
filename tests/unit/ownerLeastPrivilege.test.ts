import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APEX_NATIONAL_DEALERSHIP_ID } from '../../src/lib/apex/platformConstants';
import {
  canAccessDealershipPii,
  isUsableDealershipId,
  ownerMayExerciseDealershipPrivilege,
  requireDealershipScope,
  DealershipScopeRequiredError,
} from '../../src/lib/apex/tenantScope';

describe('Phase 6.1 owner least-privilege', () => {
  it('rejects national sentinel as a usable rooftop', () => {
    assert.equal(isUsableDealershipId(APEX_NATIONAL_DEALERSHIP_ID), false);
    assert.equal(isUsableDealershipId(''), false);
    assert.equal(isUsableDealershipId('seed-dealership'), true);
  });

  it('blocks national-scope owners from dealership PII', () => {
    const prev = process.env.PLATFORM_MODE;
    process.env.PLATFORM_MODE = 'apex';
    try {
      const nationalOwner = {
        role: 'owner',
        dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
        dealerId: null as string | null,
        scopeMode: 'national' as const,
        isOwner: true,
      };
      assert.equal(canAccessDealershipPii(nationalOwner), false);
      assert.equal(ownerMayExerciseDealershipPrivilege(nationalOwner), false);
      assert.throws(
        () => requireDealershipScope(nationalOwner),
        (err: unknown) => err instanceof DealershipScopeRequiredError
      );
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = prev;
    }
  });

  it('allows owners only after entering a real rooftop', () => {
    const prev = process.env.PLATFORM_MODE;
    process.env.PLATFORM_MODE = 'apex';
    try {
      const inDealership = {
        role: 'owner',
        dealershipId: 'seed-dealership',
        dealerId: null as string | null,
        scopeMode: 'dealership' as const,
        activeDealershipId: 'seed-dealership',
        isOwner: true,
      };
      assert.equal(canAccessDealershipPii(inDealership), true);
      assert.equal(ownerMayExerciseDealershipPrivilege(inDealership), true);
      const scope = requireDealershipScope(inDealership);
      assert.equal(scope.dealershipId, 'seed-dealership');
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = prev;
    }
  });

  it('rejects owner dealership scope pinned to national sentinel', () => {
    const prev = process.env.PLATFORM_MODE;
    process.env.PLATFORM_MODE = 'apex';
    try {
      const bad = {
        role: 'owner',
        dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
        dealerId: null as string | null,
        scopeMode: 'dealership' as const,
        activeDealershipId: APEX_NATIONAL_DEALERSHIP_ID,
        isOwner: true,
      };
      assert.equal(canAccessDealershipPii(bad), false);
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = prev;
    }
  });
});
