import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  complianceFieldsDiffer,
  toTechnicianSession,
} from '../../src/lib/sessionRefresh';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '../../src/types';

const basePayload = {
  technicianId: 'tech-1',
  d7Number: 'D7TECH001',
  name: 'Alex Technician',
  role: 'technician',
  isAdmin: false,
  dealershipId: 'dealer-1',
  dealershipName: 'Test Dealership',
  serviceAdvisorId: null,
  consentAt: '2026-06-01T00:00:00.000Z',
  consentVersion: CONSENT_VERSION,
  legalDisclaimerAt: '2026-06-01T00:00:00.000Z',
  legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
  sessionVersion: 1,
};

describe('sessionRefresh', () => {
  it('detects compliance field drift between JWT and DB session', () => {
    assert.equal(
      complianceFieldsDiffer(
        { ...basePayload, consentVersion: 'old-version' },
        basePayload
      ),
      true
    );
    assert.equal(
      complianceFieldsDiffer(
        { ...basePayload, legalDisclaimerAt: null },
        basePayload
      ),
      true
    );
    assert.equal(complianceFieldsDiffer(basePayload, basePayload), false);
  });

  it('maps session payload to client TechnicianSession without sessionVersion', () => {
    const mapped = toTechnicianSession(basePayload);
    assert.equal(mapped.technicianId, 'tech-1');
    assert.equal(mapped.consentVersion, CONSENT_VERSION);
    assert.equal(mapped.legalDisclaimerVersion, LEGAL_DISCLAIMER_VERSION);
    assert.equal('sessionVersion' in mapped, false);
  });
});