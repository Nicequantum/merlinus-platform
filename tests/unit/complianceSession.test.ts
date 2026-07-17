import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { needsConsent, needsLegalDisclaimer } from '@/lib/complianceSession';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '@/types';

describe('compliance session gating', () => {
  it('requires consent when timestamp or version is missing or stale', () => {
    assert.equal(needsConsent({ consentAt: null, consentVersion: null, legalDisclaimerAt: null, legalDisclaimerVersion: null }), true);
    assert.equal(
      needsConsent({
        consentAt: '2026-06-01T00:00:00.000Z',
        consentVersion: 'old-version',
        legalDisclaimerAt: null,
        legalDisclaimerVersion: null,
      }),
      true
    );
    assert.equal(
      needsConsent({
        consentAt: '2026-06-01T00:00:00.000Z',
        consentVersion: CONSENT_VERSION,
        legalDisclaimerAt: null,
        legalDisclaimerVersion: null,
      }),
      false
    );
  });

  it('requires legal disclaimer when timestamp or version is missing or stale', () => {
    assert.equal(
      needsLegalDisclaimer({
        consentAt: '2026-06-01T00:00:00.000Z',
        consentVersion: CONSENT_VERSION,
        legalDisclaimerAt: null,
        legalDisclaimerVersion: null,
      }),
      true
    );
    assert.equal(
      needsLegalDisclaimer({
        consentAt: '2026-06-01T00:00:00.000Z',
        consentVersion: CONSENT_VERSION,
        legalDisclaimerAt: '2026-06-01T00:00:00.000Z',
        legalDisclaimerVersion: 'old-version',
      }),
      true
    );
    assert.equal(
      needsLegalDisclaimer({
        consentAt: '2026-06-01T00:00:00.000Z',
        consentVersion: CONSENT_VERSION,
        legalDisclaimerAt: '2026-06-26T00:00:00.000Z',
        legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
      }),
      false
    );
  });
});