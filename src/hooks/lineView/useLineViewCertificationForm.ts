'use client';

import { useEffect, useState } from 'react';
import type { StoryCertificationRecord } from '@/hooks/repairOrders/useROStoryWorkflow';
import {
  deriveStoryComplianceState,
  isCopyForCdkLocked,
  type StoryComplianceState,
} from '@/lib/storyComplianceState';
import type { StoryQualityResult } from '@/types';

interface UseLineViewCertificationFormInput {
  lineId: string;
  isCustomerPayLine: boolean;
  technicianName?: string;
  hasWarrantyStory: boolean;
  storyQuality: StoryQualityResult | null;
  storyQualityStale: boolean;
  storyCertification: StoryCertificationRecord | null;
  lastGeneratedStoryText: string | null;
}

export function useLineViewCertificationForm({
  lineId,
  isCustomerPayLine,
  technicianName,
  hasWarrantyStory,
  storyQuality,
  storyQualityStale,
  storyCertification,
  lastGeneratedStoryText,
}: UseLineViewCertificationFormInput) {
  const [certificationChecked, setCertificationChecked] = useState(false);
  const [certificationName, setCertificationName] = useState('');

  const hasValidAuditForCurrentStory = Boolean(storyQuality) && !storyQualityStale;
  const isStoryCertified = Boolean(storyCertification);
  const hasAiGeneratedStory = Boolean(lastGeneratedStoryText);
  const hasCurrentAuditScore = Boolean(storyQuality);
  const certificationPendingReaudit = storyQualityStale && !isStoryCertified;
  const showCertificationSection =
    !isCustomerPayLine &&
    hasAiGeneratedStory &&
    (hasCurrentAuditScore || certificationPendingReaudit || isStoryCertified);
  const isCertificationComplete =
    certificationChecked && certificationName.trim().length >= 2;

  const storyComplianceState: StoryComplianceState = deriveStoryComplianceState({
    isCustomerPayLine,
    hasValidAudit: hasValidAuditForCurrentStory,
    isAuditStale: storyQualityStale,
    isCertified: isStoryCertified,
  });

  const certificationActionsLocked = isCopyForCdkLocked({
    isCustomerPayLine,
    hasWarrantyStory,
    hasValidAudit: hasValidAuditForCurrentStory,
    isCertified: isStoryCertified,
  });

  useEffect(() => {
    setCertificationChecked(false);
    setCertificationName('');
  }, [lineId]);

  useEffect(() => {
    setCertificationChecked(false);
    setCertificationName('');
  }, [storyQuality?.scoredAgainstStory, storyQuality?.score]);

  useEffect(() => {
    if (storyCertification) {
      setCertificationChecked(true);
      setCertificationName(storyCertification.certifiedByName);
    }
  }, [storyCertification]);

  useEffect(() => {
    if (!storyCertification && !certificationName.trim() && technicianName?.trim()) {
      setCertificationName(technicianName.trim());
    }
  }, [lineId, technicianName, storyCertification, certificationName]);

  return {
    certificationChecked,
    setCertificationChecked,
    certificationName,
    setCertificationName,
    showCertificationSection,
    certificationPendingReaudit,
    isStoryCertified,
    isCertificationComplete,
    certificationActionsLocked,
    storyComplianceState,
  };
}