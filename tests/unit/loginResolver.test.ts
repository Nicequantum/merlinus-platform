import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isCredentialRoleAllowed } from '../../src/lib/apex/credentialType';
import {
  mapMembershipsToLoginDealerships,
  validateTechnicianForLogin,
} from '../../src/lib/apex/loginResolver';

describe('loginResolver (Phase 5.3)', () => {
  test('validateTechnicianForLogin rejects inactive accounts', () => {
    const tech = {
      id: 't1',
      role: 'technician',
      isActive: false,
      deletedAt: null,
      serviceAdvisorId: null,
      dealership: { id: 'd1', name: 'Test', dealerId: null },
    };
    assert.equal(validateTechnicianForLogin(tech as never, 'd7'), false);
  });

  test('validateTechnicianForLogin rejects wrong role for credential type', () => {
    const owner = {
      id: 'o1',
      role: 'owner',
      isActive: true,
      deletedAt: null,
      serviceAdvisorId: null,
      dealership: { id: 'd1', name: 'Test', dealerId: null },
    };
    assert.equal(validateTechnicianForLogin(owner as never, 'd7'), false);
    assert.equal(isCredentialRoleAllowed('email', 'owner'), true);
    assert.equal(validateTechnicianForLogin(owner as never, 'email'), true);
  });

  test('validateTechnicianForLogin requires serviceAdvisorId for advisor role', () => {
    const advisor = {
      id: 'a1',
      role: 'service_advisor',
      isActive: true,
      deletedAt: null,
      serviceAdvisorId: null,
      dealership: { id: 'd1', name: 'Test', dealerId: null },
    };
    assert.equal(validateTechnicianForLogin(advisor as never, 'd7'), false);

    const linkedAdvisor = { ...advisor, serviceAdvisorId: 'sa-1' };
    assert.equal(validateTechnicianForLogin(linkedAdvisor as never, 'd7'), true);
  });

  test('mapMembershipsToLoginDealerships maps selector payload', () => {
    const options = mapMembershipsToLoginDealerships([
      {
        id: 'm1',
        technicianId: 't1',
        dealershipId: 'd1',
        role: 'technician',
        isPrimary: true,
        isActive: true,
        createdAt: new Date(),
        dealership: { id: 'd1', name: 'Tiverton', dealerId: 'dealer-1' },
      },
      {
        id: 'm2',
        technicianId: 't1',
        dealershipId: 'd2',
        role: 'technician',
        isPrimary: false,
        isActive: true,
        createdAt: new Date(),
        dealership: { id: 'd2', name: 'Providence', dealerId: 'dealer-2' },
      },
    ]);

    assert.equal(options.length, 2);
    assert.deepEqual(options[0], {
      id: 'd1',
      name: 'Tiverton',
      dealerCode: null,
      isPrimary: true,
    });
    assert.equal(options[1].isPrimary, false);
  });
});