/**
 * Warranty story generation — compatibility surface.
 * Brand packs live under src/prompts/story/; this module re-exports Mercedes defaults
 * and shared builders for existing imports.
 */
import type { RepairLine, RepairOrder } from '../types';
import {
  buildStoryUserMessage,
  DEFAULT_STORY_BRAND,
  resolveStoryBrandPack,
  shouldRegenerateStory,
  type StoryBrandId,
  type StoryBrandPack,
} from './story';
import {
  MERCEDES_STORY_PACK,
  MERCEDES_SYSTEM_PROMPT,
  MERCEDES_THREE_C_GENERATION_RULES,
  MERCEDES_VETERAN_PERSONAS,
  MERCEDES_WORKFLOW_STEPS,
  MERCEDES_WORKFLOW_SUMMARY,
} from './story/brands/mercedes';
import {
  selectPersonaFromPack,
  type BuildStoryUserMessageOptions,
} from './story/shared/buildUserMessage';
import { PROMPT_FIELD_LIMITS as SHARED_FIELD_LIMITS } from './story/shared/fieldLimits';
import { STORY_REGENERATE_SYSTEM_ADDENDUM } from './story/shared/regenerateRules';

/** Higher temperature for natural voice variation between lines and technicians. */
export const WARRANTY_STORY_TEMPERATURE = 0.42;

/** Cool on edit passes — favor fidelity to current story + required corrections only. */
export const WARRANTY_STORY_REGENERATE_TEMPERATURE = 0.18;

/** Room for long 3C narratives with complete diagnostic workflow and measurements. */
export const WARRANTY_STORY_MAX_TOKENS = 4096;

export const PROMPT_FIELD_LIMITS = SHARED_FIELD_LIMITS;

/** @deprecated Prefer pack.workflowSteps — Mercedes default for compat. */
export const WARRANTY_WORKFLOW_STEPS = MERCEDES_WORKFLOW_STEPS;

/** @deprecated Prefer pack.workflowSummary */
export const WARRANTY_WORKFLOW_SUMMARY = MERCEDES_WORKFLOW_SUMMARY;

/** @deprecated Prefer pack.personas */
export const VETERAN_TECH_PERSONAS = MERCEDES_VETERAN_PERSONAS;

export function selectVeteranPersona(lineNumber: number) {
  return selectPersonaFromPack(MERCEDES_STORY_PACK, lineNumber);
}

/** @deprecated Prefer pack system rules — Mercedes voice preserved. */
export const THREE_C_GENERATION_RULES = MERCEDES_THREE_C_GENERATION_RULES;

/** @deprecated Prefer resolveStoryBrandPack(brand).systemPrompt */
export const SYSTEM_PROMPT = MERCEDES_SYSTEM_PROMPT;

/** Style templates (unused in live generate path; retained for tests/docs). */
export const STORY_TEMPLATES = [
  'Chronological narrative in flowing paragraphs: customer presentation, full diagnostic workflow, cause conclusion, repair, and verification drive — one continuous technician story.',
  'Evidence-first prose: open with test drive and source voltage, then walk through XENTRY Quick Test, guided tests, findings, repair, and final verification without list formatting.',
  'Concise audit record: tight technician sentences, every workflow step present in paragraph form, honest placeholders for undocumented elements.',
  'Road-test bookends: initial and final drives frame the story; diagnostics and repair unfold naturally between them.',
  'XENTRY-centered paragraphs: foreground Quick Test and guided testing as the backbone of the cause narrative.',
  'Line-focused submission: open with the line job label and technician-documented findings; close with documented verification in plain technician language.',
];

export type BuildWarrantyStoryOptions = {
  brand?: StoryBrandId | string | null;
  pack?: StoryBrandPack;
} & BuildStoryUserMessageOptions;

/**
 * Build generate user message with strict truth filter (no Customer Complaint / RO complaints).
 * Defaults to Mercedes pack when brand is omitted (legacy callers / pilot).
 * When the line already has a substantial warranty story, builds a REVISION prompt that
 * integrates prior narrative + tech-detail additions (not a notes-only first pass).
 */
export function buildWarrantyStoryUserMessage(
  ro: RepairOrder,
  line: RepairLine,
  options?: BuildWarrantyStoryOptions
): string {
  const pack =
    options?.pack ??
    resolveStoryBrandPack(options?.brand ?? DEFAULT_STORY_BRAND, {
      preferDefaultMercedes: true,
    });
  const { brand: _b, pack: _p, ...messageOptions } = options ?? {};
  return buildStoryUserMessage(ro, line, pack, messageOptions);
}

export function getStorySystemPrompt(
  brand?: StoryBrandId | string | null,
  options?: { regenerate?: boolean; line?: RepairLine }
): string {
  const pack = resolveStoryBrandPack(brand ?? DEFAULT_STORY_BRAND, {
    preferDefaultMercedes: true,
  });
  const regen =
    options?.regenerate === true ||
    (options?.line ? shouldRegenerateStory(options.line) : false);
  if (!regen) return pack.systemPrompt;
  return `${pack.systemPrompt}

${STORY_REGENERATE_SYSTEM_ADDENDUM}`;
}

export { shouldRegenerateStory, STORY_REGENERATE_SYSTEM_ADDENDUM };
