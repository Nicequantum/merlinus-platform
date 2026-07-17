import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectiveIsAdmin,
  effectiveRole,
  effectiveServiceAdvisorId,
  isOwnerDealershipView,
  resolveViewAsClaims,
  viewAsRoleLabel,
  VIEW_AS_ROLE_OPTIONS,
} from '../../src/lib/apex/viewAs';

describe('National Owner View As helpers', () => {
  it('exposes dual-selector role options', () => {
    const values = VIEW_AS_ROLE_OPTIONS.map((o) => o.value);
    assert.ok(values.includes('technician'));
    assert.ok(values.includes('service_advisor'));
    assert.ok(values.includes('manager'));
    assert.ok(values.includes('general_manager'));
    assert.ok(values.includes('dealership_owner'));
  });

  it('isOwnerDealershipView only for owner + dealership scope', () => {
    assert.equal(
      isOwnerDealershipView({ role: 'owner', scopeMode: 'dealership' }),
      true
    );
    assert.equal(isOwnerDealershipView({ role: 'owner', scopeMode: 'national' }), false);
    assert.equal(isOwnerDealershipView({ role: 'manager', scopeMode: 'dealership' }), false);
  });

  it('effectiveRole returns lens while Viewing As', () => {
    assert.equal(
      effectiveRole({
        role: 'owner',
        scopeMode: 'dealership',
        viewAsRole: 'technician',
      }),
      'technician'
    );
    assert.equal(
      effectiveRole({
        role: 'owner',
        scopeMode: 'dealership',
        viewAsRole: 'manager',
      }),
      'manager'
    );
    assert.equal(
      effectiveRole({
        role: 'owner',
        scopeMode: 'dealership',
        viewAsRole: null,
      }),
      'owner'
    );
    assert.equal(
      effectiveRole({ role: 'owner', scopeMode: 'national', viewAsRole: 'manager' }),
      'owner'
    );
  });

  it('effectiveIsAdmin only for GM lens or native owner seed admin', () => {
    assert.equal(
      effectiveIsAdmin({
        role: 'owner',
        scopeMode: 'dealership',
        viewAsRole: 'manager',
        viewAsAdmin: true,
        isAdmin: false,
      }),
      true
    );
    assert.equal(
      effectiveIsAdmin({
        role: 'owner',
        scopeMode: 'dealership',
        viewAsRole: 'manager',
        viewAsAdmin: false,
        isAdmin: true,
      }),
      false
    );
    assert.equal(
      effectiveIsAdmin({
        role: 'owner',
        scopeMode: 'dealership',
        viewAsRole: null,
        isAdmin: true,
      }),
      true
    );
  });

  it('effectiveServiceAdvisorId prefers view-as bind for advisor lens', () => {
    assert.equal(
      effectiveServiceAdvisorId({
        role: 'owner',
        scopeMode: 'dealership',
        viewAsRole: 'service_advisor',
        viewAsServiceAdvisorId: 'sa-1',
        serviceAdvisorId: 'sa-other',
      }),
      'sa-1'
    );
    assert.equal(
      effectiveServiceAdvisorId({
        role: 'service_advisor',
        serviceAdvisorId: 'sa-real',
      }),
      'sa-real'
    );
  });

  it('resolveViewAsClaims maps UI roles to session lens', () => {
    assert.deepEqual(resolveViewAsClaims({ role: 'dealership_owner' }), {
      viewAsRole: null,
      viewAsAdmin: false,
      viewAsServiceAdvisorId: null,
    });
    assert.deepEqual(resolveViewAsClaims({ role: 'general_manager' }), {
      viewAsRole: 'manager',
      viewAsAdmin: true,
      viewAsServiceAdvisorId: null,
    });
    assert.deepEqual(
      resolveViewAsClaims({ role: 'service_advisor', serviceAdvisorId: 'sa-9' }),
      {
        viewAsRole: 'service_advisor',
        viewAsAdmin: false,
        viewAsServiceAdvisorId: 'sa-9',
      }
    );
    assert.deepEqual(resolveViewAsClaims({ role: 'technician' }), {
      viewAsRole: 'technician',
      viewAsAdmin: false,
      viewAsServiceAdvisorId: null,
    });
  });

  it('viewAsRoleLabel humanizes lens for banner', () => {
    assert.equal(
      viewAsRoleLabel({
        role: 'owner',
        scopeMode: 'dealership',
        viewAsRole: 'manager',
        viewAsAdmin: true,
      }),
      'General Manager'
    );
    assert.equal(
      viewAsRoleLabel({
        role: 'owner',
        scopeMode: 'dealership',
        viewAsRole: 'technician',
      }),
      'Technician'
    );
    assert.equal(
      viewAsRoleLabel({ role: 'owner', scopeMode: 'dealership', viewAsRole: null }),
      'Dealership Owner'
    );
    assert.equal(viewAsRoleLabel({ role: 'manager', scopeMode: 'dealership' }), '');
  });
});
