import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { complianceFieldsFromTechnician } from '../helpers/integrationCompliance';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '@/types';

describe('integration compliance fixtures', () => {
  it('fills missing compliance fields with current policy versions', () => {
    const fields = complianceFieldsFromTechnician({
      consentAt: null,
      consentVersion: null,
      legalDisclaimerAt: null,
      legalDisclaimerVersion: null,
    });

    assert.equal(fields.consentVersion, CONSENT_VERSION);
    assert.equal(fields.legalDisclaimerVersion, LEGAL_DISCLAIMER_VERSION);
    assert.ok(fields.consentAt);
    assert.ok(fields.legalDisclaimerAt);
  });

  it('preserves existing compliant technician fields', () => {
    const fields = complianceFieldsFromTechnician({
      consentAt: new Date('2026-06-01T00:00:00.000Z'),
      consentVersion: CONSENT_VERSION,
      legalDisclaimerAt: new Date('2026-06-26T00:00:00.000Z'),
      legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
    });

    assert.equal(fields.consentVersion, CONSENT_VERSION);
    assert.equal(fields.legalDisclaimerVersion, LEGAL_DISCLAIMER_VERSION);
    assert.equal(fields.consentAt, '2026-06-01T00:00:00.000Z');
    assert.equal(fields.legalDisclaimerAt, '2026-06-26T00:00:00.000Z');
  });
});