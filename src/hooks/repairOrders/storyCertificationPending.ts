import type { StoryCertificationRecord } from '@/hooks/repairOrders/useROStoryWorkflow';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { isStoryQualityCurrent } from '@/lib/storyQualityState';
import type { RepairLine, StoryQualityResult } from '@/types';

export function isStoryCertificationPendingForLine(
  lineId: string,
  line: RepairLine | undefined,
  lastGeneratedStoryByLine: Record<string, string>,
  storyQualityByLine: Record<string, StoryQualityResult>,
  storyCertificationByLine: Record<string, StoryCertificationRecord>
): boolean {
  if (!line || isCustomerPayRepairLine(line)) return false;
  if (!lastGeneratedStoryByLine[lineId]) return false;

  const quality = storyQualityByLine[lineId];
  if (!quality) return false;

  const storyText = line.warrantyStory?.trim() ?? '';
  if (!storyText || !isStoryQualityCurrent(quality, storyText)) return false;

  const certification = storyCertificationByLine[lineId];
  return !certification || certification.storyText !== storyText;
}