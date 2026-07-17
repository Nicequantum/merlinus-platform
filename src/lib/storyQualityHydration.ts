import { isStoryQualityCurrent } from '@/lib/storyQualityState';
import type { RepairOrder, StoryQualityResult, StoryReviewResult } from '@/types';

function isStoryReviewResult(value: StoryQualityResult): value is StoryReviewResult {
  return 'feedback' in value && value.feedback != null;
}

/** Build in-memory audit maps from persisted line data when the story still matches. */
export function hydrateStoryQualityFromRO(ro: RepairOrder): {
  qualityByLine: Record<string, StoryQualityResult>;
  reviewByLine: Record<string, StoryReviewResult>;
} {
  const qualityByLine: Record<string, StoryQualityResult> = {};
  const reviewByLine: Record<string, StoryReviewResult> = {};

  for (const line of ro.repairLines) {
    const audit = line.storyQualityAudit;
    const storyText = line.warrantyStory?.trim() ?? '';
    if (!audit || !storyText || !isStoryQualityCurrent(audit, storyText)) continue;

    qualityByLine[line.id] = audit;
    if (isStoryReviewResult(audit)) {
      reviewByLine[line.id] = audit;
    }
  }

  return { qualityByLine, reviewByLine };
}