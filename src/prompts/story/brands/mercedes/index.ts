import type { StoryBrandPack } from '../../shared/types';
import { MERCEDES_VETERAN_PERSONAS } from './personas';
import { MERCEDES_QUALITY } from './quality/scoreCriteria';
import { MERCEDES_SYSTEM_PROMPT } from './systemPrompt';
import { MERCEDES_WORKFLOW_STEPS, MERCEDES_WORKFLOW_SUMMARY } from './workflow';

export const MERCEDES_STORY_PACK: StoryBrandPack = {
  id: 'mercedes',
  packVersion: '1.0.0',
  displayLabel: 'Mercedes-Benz',
  systemPrompt: MERCEDES_SYSTEM_PROMPT,
  workflowSteps: MERCEDES_WORKFLOW_STEPS,
  workflowSummary: MERCEDES_WORKFLOW_SUMMARY,
  personas: MERCEDES_VETERAN_PERSONAS,
  diagnosticsSourceLabel: 'Xentry photos',
  generateClosingInstruction: (lineNumber, personaId) =>
    `Write a production 3C warranty narrative for Line ${lineNumber} only.
Cover the full 10-step Mercedes-Benz diagnostic workflow in chronological order inside flowing paragraphs.
Use persona ${personaId}'s voice — must sound human and distinct from other lines.`,
  quality: MERCEDES_QUALITY,
};

export {
  MERCEDES_SYSTEM_PROMPT,
  MERCEDES_THREE_C_GENERATION_RULES,
} from './systemPrompt';
export { MERCEDES_WORKFLOW_STEPS, MERCEDES_WORKFLOW_SUMMARY } from './workflow';
export { MERCEDES_VETERAN_PERSONAS } from './personas';
