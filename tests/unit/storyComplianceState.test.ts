import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveStoryComplianceState,
  isCopyForCdkLocked,
} from '@/lib/storyComplianceState';

describe('story compliance state', () => {
  it('derives not-audited → audited → certified progression', () => {
    assert.equal(
      deriveStoryComplianceState({
        isCustomerPayLine: false,
        hasValidAudit: false,
        isAuditStale: false,
        isCertified: false,
      }),
      'not-audited'
    );
    assert.equal(
      deriveStoryComplianceState({
        isCustomerPayLine: false,
        hasValidAudit: true,
        isAuditStale: false,
        isCertified: false,
      }),
      'audited'
    );
    assert.equal(
      deriveStoryComplianceState({
        isCustomerPayLine: false,
        hasValidAudit: true,
        isAuditStale: false,
        isCertified: true,
      }),
      'certified'
    );
    assert.equal(
      deriveStoryComplianceState({
        isCustomerPayLine: false,
        hasValidAudit: false,
        isAuditStale: true,
        isCertified: false,
      }),
      'audit-stale'
    );
  });

  it('C-FINAL-2: locks Copy for CDK until audit and certification complete', () => {
    const warranty = {
      isCustomerPayLine: false,
      hasWarrantyStory: true,
    };

    assert.equal(
      isCopyForCdkLocked({ ...warranty, hasValidAudit: false, isCertified: false }),
      true,
      'never audited'
    );
    assert.equal(
      isCopyForCdkLocked({ ...warranty, hasValidAudit: true, isCertified: false }),
      true,
      'audited but not certified'
    );
    assert.equal(
      isCopyForCdkLocked({ ...warranty, hasValidAudit: true, isCertified: true }),
      false,
      'audited and certified'
    );
    assert.equal(
      isCopyForCdkLocked({
        isCustomerPayLine: true,
        hasWarrantyStory: true,
        hasValidAudit: false,
        isCertified: false,
      }),
      false,
      'customer pay bypasses gate'
    );
  });
});