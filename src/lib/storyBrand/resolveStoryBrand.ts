import 'server-only';

import {
  DEFAULT_STORY_BRAND,
  FALLBACK_STORY_BRAND,
  isStoryBrandId,
  resolveStoryBrandId,
  type StoryBrandId,
} from '@/prompts/story';
import type { BrandKey } from '@/lib/apex/dealerTemplates';

/** Map Apex provision template brand → durable story brand. */
export function storyBrandFromTemplateBrand(brand: BrandKey): StoryBrandId {
  if (brand === 'mercedes') return 'mercedes';
  // base (none) and generic rooftops start on generic story pack
  return 'generic';
}

/** Resolve from Dealership.storyBrand (or missing → mercedes for existing pilot rows). */
export function storyBrandFromDealership(
  dealership: { storyBrand?: string | null } | null | undefined
): StoryBrandId {
  const raw = dealership?.storyBrand?.trim().toLowerCase();
  if (!raw) return DEFAULT_STORY_BRAND;
  if (isStoryBrandId(raw)) return raw;
  return FALLBACK_STORY_BRAND;
}

export function resolveStoryBrandForSession(dealershipStoryBrand?: string | null): StoryBrandId {
  return resolveStoryBrandId(dealershipStoryBrand, { preferDefaultMercedes: true });
}
