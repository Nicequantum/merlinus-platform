import { GROK_STORY_MODEL } from '@/lib/grokModels';
import {
  STORY_GENERATE_CLIENT_MS,
  STORY_GENERATE_GROK_MS,
  STORY_GENERATE_ROUTE_MAX_DURATION_S,
} from '@/lib/timeouts';
import {
  DEFAULT_STORY_BRAND,
  resolveStoryBrandPack,
  type StoryBrandId,
} from '@/prompts/story';
import {
  WARRANTY_STORY_MAX_TOKENS,
  buildWarrantyStoryUserMessage,
} from '@/prompts/warrantyStory';
import type { RepairLine, RepairOrder } from '@/types';

/** Snapshot of the live story-generation pipeline for perf investigations. */
export interface StoryGenerationPipelineAudit {
  model: string;
  reasoningEffort: string;
  systemPromptChars: number;
  userMessageChars: number;
  totalPromptChars: number;
  maxOutputTokens: number;
  preGrokDbOps: string[];
  excludedFromPrompt: string[];
  storyBrand?: StoryBrandId | string;
  packVersion?: string;
  timeouts: {
    grokMs: number;
    routeMaxDurationS: number;
    clientMs: number;
  };
}

export function resolveStoryReasoningEffort(model: string): string {
  if (model.includes('non-reasoning')) return 'not used (non-reasoning model)';
  if (model.includes('grok-4')) return 'none';
  return 'not sent';
}

export function auditStoryGenerationPipeline(
  ro: RepairOrder,
  line: RepairLine,
  options?: { brand?: string | null }
): StoryGenerationPipelineAudit {
  const pack = resolveStoryBrandPack(options?.brand ?? DEFAULT_STORY_BRAND, {
    preferDefaultMercedes: true,
  });
  const userMessage = buildWarrantyStoryUserMessage(ro, line, { pack });
  const systemPromptChars = pack.systemPrompt.length;
  return {
    model: GROK_STORY_MODEL,
    reasoningEffort: resolveStoryReasoningEffort(GROK_STORY_MODEL),
    systemPromptChars,
    userMessageChars: userMessage.length,
    totalPromptChars: systemPromptChars + userMessage.length,
    maxOutputTokens: WARRANTY_STORY_MAX_TOKENS,
    preGrokDbOps: ['prisma.repairOrder.findUnique (RO + lines)', 'dbToRepairOrder field decrypt'],
    excludedFromPrompt: [
      'knowledgeBase',
      'historyContext',
      'advisorIntelligence',
      'storyTemplates',
      'roLevelOcr',
      'allRepairLineDescriptions',
      'customerComplaint',
      'roAdvisorComplaints',
    ],
    storyBrand: pack.id,
    packVersion: pack.packVersion,
    timeouts: {
      grokMs: STORY_GENERATE_GROK_MS,
      routeMaxDurationS: STORY_GENERATE_ROUTE_MAX_DURATION_S,
      clientMs: STORY_GENERATE_CLIENT_MS,
    },
  };
}