import type { RepairOrder } from '@/types';

/**
 * Client-safe certification hydration — uses API-validated storyCertification only.
 * Do not import server encryption/hash modules here (breaks the login bundle).
 */
export function hydrateStoryWorkflowFromRO(ro: RepairOrder): {
  certificationByLine: Record<string, { certifiedByName: string; certifiedAt: string; storyText: string }>;
  lastGeneratedByLine: Record<string, string>;
} {
  const certificationByLine: Record<string, { certifiedByName: string; certifiedAt: string; storyText: string }> =
    {};
  const lastGeneratedByLine: Record<string, string> = {};

  for (const line of ro.repairLines) {
    const storyText = line.warrantyStory?.trim() ?? '';
    if (!storyText || line.isCustomerPay) continue;

    const certification = line.storyCertification;
    if (certification?.certifiedByName && certification.certifiedAt) {
      certificationByLine[line.id] = {
        certifiedByName: certification.certifiedByName,
        certifiedAt: certification.certifiedAt,
        storyText,
      };
    }

    if (line.storyQualityAudit || certification) {
      lastGeneratedByLine[line.id] = storyText;
    }
  }

  return { certificationByLine, lastGeneratedByLine };
}