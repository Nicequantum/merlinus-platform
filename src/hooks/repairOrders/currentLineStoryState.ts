import type { RepairLine, RepairOrder, StoryQualityResult, StoryReviewResult } from '@/types';
import { isStoryQualityCurrent, storiesMatchForAudit } from '@/lib/storyQualityState';
import type { StoryCertificationRecord } from '@/hooks/repairOrders/useROStoryWorkflow';

interface CurrentLineStoryStateInput {
  currentRO: RepairOrder | null;
  currentLineId: string | null;
  isGenerating: boolean;
  generatingLineId: string | null;
  isScoring: boolean;
  scoringLineId: string | null;
  isReviewing: boolean;
  reviewingLineId: string | null;
  storyQualityByLine: Record<string, StoryQualityResult>;
  storyReviewByLine: Record<string, StoryReviewResult>;
  storyCertificationByLine: Record<string, StoryCertificationRecord>;
  lastGeneratedStoryByLine: Record<string, string>;
  cdkSanitizedByLine: Record<string, boolean>;
}

export function deriveCurrentLineStoryState({
  currentRO,
  currentLineId,
  isGenerating,
  generatingLineId,
  isScoring,
  scoringLineId,
  isReviewing,
  reviewingLineId,
  storyQualityByLine,
  storyReviewByLine,
  storyCertificationByLine,
  lastGeneratedStoryByLine,
  cdkSanitizedByLine,
}: CurrentLineStoryStateInput) {
  const currentLine = currentRO?.repairLines.find((l) => l.id === currentLineId);
  const lastGeneratedStoryForLine =
    currentLineId && lastGeneratedStoryByLine[currentLineId]
      ? lastGeneratedStoryByLine[currentLineId]
      : null;
  const cdkSanitizedForLine = Boolean(currentLineId && cdkSanitizedByLine[currentLineId]);

  const isGeneratingForLine = isGenerating && generatingLineId === currentLineId;
  const isScoringForLine = isScoring && scoringLineId === currentLineId;
  const isReviewingForLine = isReviewing && reviewingLineId === currentLineId;

  const storyQualityForLine = (() => {
    if (!currentLineId || isGeneratingForLine || isScoringForLine || isReviewingForLine) return null;
    const storyText = currentLine?.warrantyStory?.trim() ?? '';
    const quality = storyQualityByLine[currentLineId] ?? currentLine?.storyQualityAudit ?? null;
    if (!quality) return null;
    // Only show score when it matches the on-screen story — never fall back to
    // scoredAgainstStory alone (that always matched itself and froze the panel at the old audit).
    if (storyText && isStoryQualityCurrent(quality, storyText)) return quality;
    return null;
  })();

  const storyReviewForLine = (() => {
    if (!currentLineId || isGeneratingForLine || isScoringForLine || isReviewingForLine) return null;
    if (!storyQualityForLine) return null;
    return storyReviewByLine[currentLineId] ?? null;
  })();

  const storyQualityStaleForLine = (() => {
    if (!currentLineId || isGeneratingForLine || isScoringForLine || isReviewingForLine) return false;
    const quality = storyQualityByLine[currentLineId];
    const storyText = currentLine?.warrantyStory?.trim() ?? '';
    if (!quality || !storyText) return false;
    return !isStoryQualityCurrent(quality, storyText);
  })();

  const storyCertificationForLine = (() => {
    if (!currentLineId) return null;
    const storyText = currentLine?.warrantyStory?.trim() ?? '';
    if (!storyText) return null;

    const certification = storyCertificationByLine[currentLineId];
    if (certification && storiesMatchForAudit(certification.storyText, storyText)) {
      return certification;
    }

    const fromLine = currentLine?.storyCertification;
    if (fromLine?.certifiedByName && fromLine.certifiedAt) {
      return {
        certifiedByName: fromLine.certifiedByName,
        certifiedAt: fromLine.certifiedAt,
        storyText,
      };
    }

    return null;
  })();

  return {
    currentLine,
    lastGeneratedStoryForLine,
    cdkSanitizedForLine,
    isGeneratingForLine,
    isScoringForLine,
    isReviewingForLine,
    storyQualityForLine,
    storyReviewForLine,
    storyQualityStaleForLine,
    storyCertificationForLine,
  };
}