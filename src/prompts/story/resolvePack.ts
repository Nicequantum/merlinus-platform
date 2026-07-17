import {
  DEFAULT_STORY_BRAND,
  FALLBACK_STORY_BRAND,
  isStoryBrandId,
  STORY_BRAND_PACKS,
} from './registry';
import type { StoryBrandId, StoryBrandPack } from './shared/types';

/**
 * Resolve a brand pack from an explicit id.
 * Unknown ids → generic (safe default). Empty/null with preferDefaultMercedes → mercedes.
 */
export function resolveStoryBrandPack(
  brandId?: string | null,
  options?: { preferDefaultMercedes?: boolean }
): StoryBrandPack {
  const raw = brandId?.trim().toLowerCase();
  if (!raw) {
    const id = options?.preferDefaultMercedes === false ? FALLBACK_STORY_BRAND : DEFAULT_STORY_BRAND;
    return STORY_BRAND_PACKS[id];
  }
  if (isStoryBrandId(raw)) {
    return STORY_BRAND_PACKS[raw];
  }
  return STORY_BRAND_PACKS[FALLBACK_STORY_BRAND];
}

export function resolveStoryBrandId(
  brandId?: string | null,
  options?: { preferDefaultMercedes?: boolean }
): StoryBrandId {
  return resolveStoryBrandPack(brandId, options).id;
}
