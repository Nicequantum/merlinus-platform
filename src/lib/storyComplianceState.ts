export type StoryComplianceState = 'not-audited' | 'audited' | 'audit-stale' | 'certified';

export function deriveStoryComplianceState(input: {
  isCustomerPayLine: boolean;
  hasValidAudit: boolean;
  isAuditStale: boolean;
  isCertified: boolean;
}): StoryComplianceState {
  if (input.isCustomerPayLine) return 'certified';
  if (input.isCertified) return 'certified';
  if (input.isAuditStale) return 'audit-stale';
  if (input.hasValidAudit) return 'audited';
  return 'not-audited';
}

/** Warranty lines require a current audit and technician certification before CDK copy. */
export function isCopyForCdkLocked(input: {
  isCustomerPayLine: boolean;
  hasWarrantyStory: boolean;
  hasValidAudit: boolean;
  isCertified: boolean;
}): boolean {
  if (input.isCustomerPayLine) return false;
  if (!input.hasWarrantyStory) return true;
  return !input.hasValidAudit || !input.isCertified;
}

export const STORY_COMPLIANCE_LABELS: Record<StoryComplianceState, string> = {
  'not-audited': 'Not Audited',
  audited: 'Audited',
  'audit-stale': 'Audit Outdated',
  certified: 'Certified',
};