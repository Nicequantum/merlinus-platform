import { createHash } from 'crypto';
import { MI_AUDIT_GUIDELINES, MI_GENERATION_STYLE_RULES } from '@/prompts/miAuditGuidelines';
import {
  DEFAULT_STORY_BRAND,
  resolveStoryBrandPack,
  TRUTH_POLICY_ID,
  type StoryBrandId,
} from '@/prompts/story';
import { getDealershipPromptRules, PROMPT_VERSION } from '@/prompts/version';

/** M6: Hash a string for audit metadata without storing raw sensitive content. */
export function hashPromptFragment(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

export interface PromptAuditFingerprint {
  promptVersion: string;
  systemPromptHash: string;
  dealershipRulesHash: string | null;
  miGuidelinesHash: string;
  miStyleRulesHash: string;
  storyBrand: StoryBrandId | string;
  packVersion: string;
  truthPolicy: typeof TRUTH_POLICY_ID;
}

/** M6: Record which prompt building blocks were active — not just static PROMPT_VERSION. */
export function buildPromptAuditFingerprint(options?: {
  storyBrand?: StoryBrandId | string | null;
  packVersion?: string;
}): PromptAuditFingerprint {
  const dealershipRules = getDealershipPromptRules();
  const pack = resolveStoryBrandPack(options?.storyBrand ?? DEFAULT_STORY_BRAND, {
    preferDefaultMercedes: true,
  });
  return {
    promptVersion: PROMPT_VERSION,
    systemPromptHash: hashPromptFragment(pack.systemPrompt),
    dealershipRulesHash: dealershipRules ? hashPromptFragment(dealershipRules) : null,
    miGuidelinesHash: hashPromptFragment(MI_AUDIT_GUIDELINES),
    miStyleRulesHash: hashPromptFragment(MI_GENERATION_STYLE_RULES),
    storyBrand: pack.id,
    packVersion: options?.packVersion ?? pack.packVersion,
    truthPolicy: TRUTH_POLICY_ID,
  };
}

export function buildStoryGenerateAuditMetadata(input: {
  repairOrderId: string;
  lineNumber: number;
  advisorIntelligenceUsed: boolean;
  advisorContextHash: string | null;
  knowledgeBaseEntryIds: string[];
  historyContextLineCount: number;
  qualityScore: number | null;
  qualityGrade: string | null;
  serviceAdvisorId: string | null;
  storyBrand?: StoryBrandId | string | null;
  packVersion?: string;
}): Record<string, unknown> {
  const fingerprint = buildPromptAuditFingerprint({
    storyBrand: input.storyBrand,
    packVersion: input.packVersion,
  });
  return {
    repairOrderId: input.repairOrderId,
    lineNumber: input.lineNumber,
    ...fingerprint,
    advisorIntelligenceUsed: input.advisorIntelligenceUsed,
    advisorContextHash: input.advisorContextHash,
    knowledgeBaseEntryIds: input.knowledgeBaseEntryIds,
    historyContextLineCount: input.historyContextLineCount,
    qualityScore: input.qualityScore,
    qualityGrade: input.qualityGrade,
    serviceAdvisorId: input.serviceAdvisorId,
  };
}