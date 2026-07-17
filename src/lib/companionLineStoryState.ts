import type { StoryCertificationRecord } from '@/hooks/repairOrders/useROStoryWorkflow';
import { isStoryQualityCurrent, storiesMatchForAudit } from '@/lib/storyQualityState';
import type { RepairLine, RepairOrder, StoryQualityResult, StoryReviewResult } from '@/types';

export interface CompanionLineStoryStateInput {
  ro: RepairOrder;
  activeLineId: string | null;
  storyQuality: StoryQualityResult | null;
  storyReview: StoryReviewResult | null;
  storyQualityStale: boolean;
  storyCertification: StoryCertificationRecord | null;
}

export interface CompanionLineStoryState {
  activeLine: RepairLine | null;
  storyQuality: StoryQualityResult | null;
  storyReview: StoryReviewResult | null;
  storyQualityStale: boolean;
  storyCertification: StoryCertificationRecord | null;
}

function certificationRecordFromLine(line: RepairLine): StoryCertificationRecord | null {
  const storyText = line.warrantyStory?.trim() ?? '';
  const certification = line.storyCertification;
  if (!storyText || !certification?.certifiedByName || !certification.certifiedAt) return null;
  return {
    certifiedByName: certification.certifiedByName,
    certifiedAt: certification.certifiedAt,
    storyText,
  };
}

function resolveCertificationForLine(
  line: RepairLine,
  fromHook: StoryCertificationRecord | null
): StoryCertificationRecord | null {
  const storyText = line.warrantyStory?.trim() ?? '';
  if (!storyText) return null;

  if (fromHook && storiesMatchForAudit(fromHook.storyText, storyText)) {
    return fromHook;
  }

  return certificationRecordFromLine(line);
}

function resolveQualityForLine(
  line: RepairLine,
  fromHook: StoryQualityResult | null
): StoryQualityResult | null {
  const storyText = line.warrantyStory?.trim() ?? '';
  const audit = line.storyQualityAudit;
  const candidate = fromHook ?? audit ?? null;
  if (!candidate) return null;

  // Bind quality only when it matches the live story on the line.
  if (storyText && isStoryQualityCurrent(candidate, storyText)) {
    return candidate;
  }

  // Companion race: line story not synced yet — allow hook quality with a baseline only when story is empty.
  if (!storyText && fromHook?.scoredAgainstStory?.trim()) {
    return fromHook;
  }

  return null;
}

function resolveQualityStale(
  line: RepairLine,
  quality: StoryQualityResult | null,
  fromHookStale: boolean,
  rawCandidate: StoryQualityResult | null
): boolean {
  if (fromHookStale) return true;
  const storyText = line.warrantyStory?.trim() ?? '';
  if (!storyText) return false;
  // Prefer resolved quality; if null because of mismatch, still detect stale vs raw candidate.
  const check = quality ?? rawCandidate;
  if (!check?.scoredAgainstStory?.trim()) return false;
  return !isStoryQualityCurrent(check, storyText);
}

/** Merge hook-level story state with persisted line fields for the desktop companion. */
export function deriveCompanionLineStoryState({
  ro,
  activeLineId,
  storyQuality,
  storyReview,
  storyQualityStale,
  storyCertification,
}: CompanionLineStoryStateInput): CompanionLineStoryState {
  const activeLine =
    (activeLineId ? ro.repairLines.find((line) => line.id === activeLineId) : null) ??
    ro.repairLines[0] ??
    null;

  if (!activeLine) {
    return {
      activeLine: null,
      storyQuality: null,
      storyReview: null,
      storyQualityStale: false,
      storyCertification: null,
    };
  }

  const rawCandidate = storyQuality ?? activeLine.storyQualityAudit ?? null;
  const resolvedQuality = resolveQualityForLine(activeLine, storyQuality);
  const resolvedCertification = resolveCertificationForLine(activeLine, storyCertification);

  return {
    activeLine,
    storyQuality: resolvedQuality,
    storyReview: resolvedQuality ? storyReview : null,
    storyQualityStale: resolveQualityStale(
      activeLine,
      resolvedQuality,
      storyQualityStale,
      rawCandidate
    ),
    storyCertification: resolvedCertification,
  };
}