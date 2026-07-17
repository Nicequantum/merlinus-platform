import { GENERIC_STORY_PACK } from './brands/generic';
import { MERCEDES_STORY_PACK } from './brands/mercedes';
import type { StoryBrandId, StoryBrandPack } from './shared/types';

export const STORY_BRAND_IDS = ['mercedes', 'generic'] as const satisfies readonly StoryBrandId[];

export const STORY_BRAND_PACKS: Record<StoryBrandId, StoryBrandPack> = {
  mercedes: MERCEDES_STORY_PACK,
  generic: GENERIC_STORY_PACK,
};

export function isStoryBrandId(value: unknown): value is StoryBrandId {
  return typeof value === 'string' && (STORY_BRAND_IDS as readonly string[]).includes(value);
}

/** Default for registered legacy rooftops / missing brand arg (MB pilot). */
export const DEFAULT_STORY_BRAND: StoryBrandId = 'mercedes';

/**
 * Fail-safe for unknown future strings from DB: prefer generic (no OEM jargon)
 * rather than Mercedes tooling language on a non-MB rooftop.
 */
export const FALLBACK_STORY_BRAND: StoryBrandId = 'generic';
