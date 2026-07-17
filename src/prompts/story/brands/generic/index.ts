import type { StoryBrandPack } from '../../shared/types';
import { GENERIC_VETERAN_PERSONAS } from './personas';
import { GENERIC_QUALITY } from './quality/scoreCriteria';
import { GENERIC_SYSTEM_PROMPT } from './systemPrompt';
import { GENERIC_WORKFLOW_STEPS, GENERIC_WORKFLOW_SUMMARY } from './workflow';

/** Terms that must never appear in the generic pack’s authored prompts. */
export const GENERIC_FORBIDDEN_TERMS = [
  'XENTRY',
  'Xentry',
  'Quick Test',
  'Star Diagnosis',
  'Mercedes-Benz',
  'Mercedes',
  'MI 2.0',
  'Mercedes Intelligence',
] as const;

export const GENERIC_STORY_PACK: StoryBrandPack = {
  id: 'generic',
  packVersion: '1.0.0',
  displayLabel: 'Generic',
  systemPrompt: GENERIC_SYSTEM_PROMPT,
  workflowSteps: GENERIC_WORKFLOW_STEPS,
  workflowSummary: GENERIC_WORKFLOW_SUMMARY,
  personas: GENERIC_VETERAN_PERSONAS,
  diagnosticsSourceLabel: 'diagnostic photos',
  generateClosingInstruction: (lineNumber, personaId) =>
    `Write a production 3C warranty narrative for Line ${lineNumber} only.
Cover the full 10-step brand-neutral diagnostic workflow in chronological order inside flowing paragraphs.
Use persona ${personaId}'s voice — must sound human and distinct from other lines.
Keep language brand-neutral.`,
  quality: GENERIC_QUALITY,
  forbiddenTerms: GENERIC_FORBIDDEN_TERMS,
};

export { GENERIC_SYSTEM_PROMPT } from './systemPrompt';
export { GENERIC_WORKFLOW_STEPS, GENERIC_WORKFLOW_SUMMARY } from './workflow';
export { GENERIC_VETERAN_PERSONAS } from './personas';
