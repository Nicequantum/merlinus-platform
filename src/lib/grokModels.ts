/** Shared model identifiers — safe to import from tests and server code. */

/**
 * Default story generate/score model id (server).
 * Keep STORY_MODEL_DISPLAY_VERSION in sync when changing the default.
 */
export const GROK_STORY_MODEL_DEFAULT = 'grok-4.20-0309-non-reasoning';

/**
 * Story generate + score.
 * Override with GROK_STORY_MODEL for A/B (e.g. grok-4.3, grok-4.5).
 */
export const GROK_STORY_MODEL =
  process.env.GROK_STORY_MODEL?.trim() || GROK_STORY_MODEL_DEFAULT;

/**
 * Story review coaching. Defaults to story model for stack alignment;
 * override with GROK_STORY_REVIEW_MODEL if needed.
 */
export const GROK_STORY_REVIEW_MODEL =
  process.env.GROK_STORY_REVIEW_MODEL?.trim() || GROK_STORY_MODEL;

/** Vision + extraction — grok-4.3 supports image input. */
export const GROK_CHAT_MODEL = 'grok-4.3';

/**
 * Parse a short version label from an xAI model id.
 * e.g. grok-4.20-0309-non-reasoning → "4.20", grok-4.3 → "4.3", grok-4.5 → "4.5"
 */
export function parseGrokModelVersion(model: string): string {
  const match = model.trim().match(/grok-(\d+(?:\.\d+)?)/i);
  return match?.[1] ?? '4.20';
}

/**
 * Client-safe display version for MI generate/audit UI.
 * Reflects the code default story model (not vision chat model).
 * Ops A/B via GROK_STORY_MODEL should keep this constant aligned in deploys.
 */
export const STORY_MODEL_DISPLAY_VERSION = parseGrokModelVersion(GROK_STORY_MODEL_DEFAULT);

/** Product-facing label, e.g. "MI 4.20" */
export const MI_PRODUCT_LABEL = `MI ${STORY_MODEL_DISPLAY_VERSION}`;

/** Primary generate button copy */
export const GENERATE_STORY_BUTTON_LABEL = `Generate ${MI_PRODUCT_LABEL}`;
