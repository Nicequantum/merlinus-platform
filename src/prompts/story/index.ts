export type {
  StoryBrandId,
  StoryBrandPack,
  StoryBrandQualityPrompts,
  VeteranPersona,
} from './shared/types';
export { TRUTH_POLICY_ID } from './shared/types';
export { STRICT_TRUTH_RULES, TRUTH_USER_MESSAGE_BANNER } from './shared/truthRules';
export { PROMPT_FIELD_LIMITS, truncatePromptField } from './shared/fieldLimits';
export {
  buildStoryUserMessage,
  buildStoryQualityLineContext,
  selectPersonaFromPack,
  shouldRegenerateStory,
  REGENERATE_PRIOR_STORY_MIN_CHARS,
  type BuildStoryUserMessageOptions,
} from './shared/buildUserMessage';
export {
  STORY_REGENERATE_SYSTEM_ADDENDUM,
  STORY_REGENERATE_USER_HEADER,
  AUDIT_ENHANCEMENT_NOTES_MARKER,
  PENDING_CORRECTIONS_START,
  PENDING_CORRECTIONS_END,
} from './shared/regenerateRules';
export {
  STORY_BRAND_IDS,
  STORY_BRAND_PACKS,
  DEFAULT_STORY_BRAND,
  FALLBACK_STORY_BRAND,
  isStoryBrandId,
} from './registry';
export { resolveStoryBrandPack, resolveStoryBrandId } from './resolvePack';
export { MERCEDES_STORY_PACK } from './brands/mercedes';
export { GENERIC_STORY_PACK, GENERIC_FORBIDDEN_TERMS } from './brands/generic';
