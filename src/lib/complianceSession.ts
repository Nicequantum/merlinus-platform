import {
  CONSENT_VERSION,
  LEGAL_DISCLAIMER_VERSION,
  type TechnicianSession,
} from '@/types';

export type ComplianceSessionFields = Pick<
  TechnicianSession,
  'consentAt' | 'consentVersion' | 'legalDisclaimerAt' | 'legalDisclaimerVersion'
>;

/** True when provision / admin reset requires password rotation before PII routes. */
export function needsPasswordChange(
  session: Pick<TechnicianSession, 'mustChangePassword'>
): boolean {
  return Boolean(session.mustChangePassword);
}

/** True when privacy consent is missing or policy version changed. */
export function needsConsent(session: ComplianceSessionFields): boolean {
  return !session.consentAt?.trim() || session.consentVersion !== CONSENT_VERSION;
}

/** True when legal disclaimer is missing or policy version changed. */
export function needsLegalDisclaimer(session: ComplianceSessionFields): boolean {
  return (
    !session.legalDisclaimerAt?.trim() ||
    session.legalDisclaimerVersion !== LEGAL_DISCLAIMER_VERSION
  );
}