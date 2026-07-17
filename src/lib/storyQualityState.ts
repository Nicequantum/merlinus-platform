import { sanitizeForCDK } from '@/lib/sanitizeForCDK';
import type { StoryQualityResult } from '@/types';

/** Normalize story text the same way CDK persistence does before comparing audit baselines. */
export function normalizeStoryForAudit(text: string): string {
  return sanitizeForCDK(text).trim();
}

/** True when two story texts represent the same warranty narrative after CDK normalization. */
export function storiesMatchForAudit(a: string, b: string): boolean {
  const left = normalizeStoryForAudit(a);
  const right = normalizeStoryForAudit(b);
  if (!left || !right) return false;
  return left === right;
}

/** True when the panel score still reflects the story text on screen. */
export function isStoryQualityCurrent(quality: StoryQualityResult, storyText: string): boolean {
  const baseline = quality.scoredAgainstStory?.trim();
  if (!baseline) return false;
  return storiesMatchForAudit(baseline, storyText);
}