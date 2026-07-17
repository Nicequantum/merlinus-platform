import type { RepairLine, RepairOrder } from '@/types';
import { extractRequiredCorrectionsFromNotes } from '@/lib/storyRegenerateGuard';
import {
  countAppliedCorrectionsPresentInStory,
  isGapResolvedInStory,
  recommendationResolvedByApplied,
  toAuditCorrection,
} from '@/lib/storyAuditIntegration';
import {
  DEFAULT_STORY_BRAND,
  buildStoryQualityLineContext,
  resolveStoryBrandPack,
  type StoryBrandId,
  type StoryBrandPack,
} from './story';
import { MERCEDES_STORY_PACK } from './story/brands/mercedes';

export type StoryQualityGrade = 'excellent' | 'strong' | 'needs-work' | 'at-risk';

export interface TechnicianDetailPrompt {
  missing: string;
  prompt: string;
  field: 'technicianNotes' | 'customerConcern' | 'diagnostic' | 'workflow';
}

export interface StoryQualityResult {
  score: number;
  grade: StoryQualityGrade;
  strengths: string[];
  improvements: string[];
  auditRisks: string[];
  technicianDetails: TechnicianDetailPrompt[];
  summary: string;
  parseFailed?: boolean;
}

export interface StoryReviewFeedback {
  structure: string;
  technicalDetail: string;
  clarity: string;
  workflow: string;
  fabricationRisk: string;
}

export interface StoryReviewResult extends StoryQualityResult {
  feedback: StoryReviewFeedback;
  priorityActions: string[];
}

/** Mercedes defaults — pack-aware helpers accept brand for multi-rooftop. */
export const STORY_SCORE_SYSTEM_PROMPT = MERCEDES_STORY_PACK.quality.scoreSystemPrompt;
export const STORY_SCORE_RETRY_SYSTEM_PROMPT = MERCEDES_STORY_PACK.quality.scoreRetrySystemPrompt;
export const STORY_REVIEW_SYSTEM_PROMPT = MERCEDES_STORY_PACK.quality.reviewSystemPrompt;

export type StoryQualityPromptOptions = {
  brand?: StoryBrandId | string | null;
  pack?: StoryBrandPack;
};

function resolveQualityPack(options?: StoryQualityPromptOptions): StoryBrandPack {
  return (
    options?.pack ??
    resolveStoryBrandPack(options?.brand ?? DEFAULT_STORY_BRAND, { preferDefaultMercedes: true })
  );
}

export function getStoryScoreSystemPrompt(options?: StoryQualityPromptOptions): string {
  return resolveQualityPack(options).quality.scoreSystemPrompt;
}

export function getStoryScoreRetrySystemPrompt(options?: StoryQualityPromptOptions): string {
  return resolveQualityPack(options).quality.scoreRetrySystemPrompt;
}

export function getStoryReviewSystemPrompt(options?: StoryQualityPromptOptions): string {
  return resolveQualityPack(options).quality.reviewSystemPrompt;
}

export function buildStoryScoreUserMessage(
  ro: RepairOrder,
  line: RepairLine,
  warrantyStory: string,
  options?: StoryQualityPromptOptions & { addressedGaps?: string }
): string {
  const pack = resolveQualityPack(options);
  const list = extractRequiredCorrectionsFromNotes(line.technicianNotes || '');
  const addressed =
    options?.addressedGaps?.trim() ||
    (list.length ? list.map((c, i) => `${i + 1}. ${c}`).join('\n') : '');

  const addressedBlock = addressed
    ? `
===CORRECTIONS_ALREADY_APPLIED_TO_STORY===
The technician applied the following audit corrections into the warranty story above. If the story text supports each item (even partially), you MUST credit it, raise the score, and MUST NOT re-list it in technicianDetails / improvements / auditRisks:
${addressed}
===END_CORRECTIONS_ALREADY_APPLIED_TO_STORY===
`
    : '';

  return `${buildStoryQualityLineContext(ro, line, pack)}

WARRANTY STORY TO SCORE (authoritative — score THIS text as submitted):
---
${warrantyStory}
---
${addressedBlock}
Score this story for ${pack.quality.auditLabel} survival.
CRITICAL SCORING RULES:
- The warranty story above is the sole scored artifact. Credit every workflow step, code, measurement, and technical detail that appears in the story text.
- First-person lines such as "I checked source voltage...", "I performed guided diagnostic testing...", "I documented fault codes..." fully satisfy those workflow gaps when present.
- If CORRECTIONS_ALREADY_APPLIED_TO_STORY is listed and the story contains matching content, treat those gaps as closed — do not re-flag them.
- Raise the score for post-audit / Add Tech Details improvements when those fixes are present in the story. Only list technicianDetails for gaps STILL absent from the story.
- Do not penalize as fabrication when the story documents details also present in technician notes or the applied-corrections list.
- Prefer empty technicianDetails when the story is complete enough for a strong/excellent grade.
List specific missing technical details in technicianDetails only for content still missing from the story.`;
}

/**
 * Drop technicianDetails that the story already documents (post-process safety net
 * when the model re-lists fixed gaps with rephrased wording).
 */
export function filterResolvedTechnicianDetails(
  story: string,
  details: TechnicianDetailPrompt[],
  appliedCorrectionTexts: string[] = []
): TechnicianDetailPrompt[] {
  return details.filter((d) => !isGapResolvedInStory(story, d, appliedCorrectionTexts));
}

function filterResolvedTextList(
  items: string[],
  story: string,
  appliedCorrectionTexts: string[]
): string[] {
  return items.filter((item) => !recommendationResolvedByApplied(item, story, appliedCorrectionTexts));
}

/**
 * Bump score when prior gaps are closed in the story text.
 * Prefer counting applied corrections present in the story (theme-aware) over
 * sticky model scores that re-list the same themes under new wording.
 */
export function adjustScoreForResolvedGaps(
  result: StoryQualityResult,
  story: string,
  priorDetailCount: number,
  appliedCorrectionTexts: string[] = []
): StoryQualityResult {
  const remaining = filterResolvedTechnicianDetails(
    story,
    result.technicianDetails,
    appliedCorrectionTexts
  );
  const appliedPresent = countAppliedCorrectionsPresentInStory(story, appliedCorrectionTexts);
  const closedFromFilter = Math.max(0, priorDetailCount - remaining.length);
  const closed = Math.max(closedFromFilter, appliedPresent);

  const improvements = filterResolvedTextList(result.improvements, story, appliedCorrectionTexts);
  const auditRisks = filterResolvedTextList(result.auditRisks, story, appliedCorrectionTexts);

  const listsChanged =
    remaining.length !== result.technicianDetails.length ||
    improvements.length !== result.improvements.length ||
    auditRisks.length !== result.auditRisks.length;

  if (closed === 0 && !listsChanged) {
    return result;
  }

  // Credit closed gaps aggressively enough that Add All → Audit shows a real lift
  // (+5 each, cap 25). Floor bump when ≥2 applied corrections are in the story.
  const bonus = Math.min(25, closed * 5);
  let score = Math.min(100, result.score + bonus);
  if (appliedPresent >= 2 && score < result.score + 8) {
    score = Math.min(100, result.score + Math.max(bonus, 8));
  }
  if (remaining.length === 0 && appliedPresent >= 1) {
    // All re-flagged coaching items closed — ensure at least "strong" band when base was mid
    score = Math.max(score, Math.min(100, Math.max(result.score + 10, 75)));
  }

  const grade = gradeFromScore(score);
  return {
    ...result,
    score,
    grade,
    technicianDetails: remaining,
    improvements,
    auditRisks,
    summary:
      closed > 0
        ? `${result.summary} Applied corrections closed ${closed} prior gap(s); score adjusted for documented workflow fixes.`.trim()
        : result.summary,
  };
}

/**
 * Full post-process after model score: credit applied corrections from notes
 * and drop re-flagged gaps that the story already documents by theme.
 */
export function reconcileStoryQualityWithAppliedCorrections(
  result: StoryQualityResult,
  warrantyStory: string,
  technicianNotes: string
): StoryQualityResult {
  const applied = extractRequiredCorrectionsFromNotes(technicianNotes || '');
  const filteredDetails = filterResolvedTechnicianDetails(
    warrantyStory,
    result.technicianDetails,
    applied
  );
  const priorCount = Math.max(applied.length, result.technicianDetails.length);
  return adjustScoreForResolvedGaps(
    { ...result, technicianDetails: filteredDetails },
    warrantyStory,
    priorCount,
    applied
  );
}

export function buildStoryReviewUserMessage(
  ro: RepairOrder,
  line: RepairLine,
  warrantyStory: string,
  options?: StoryQualityPromptOptions
): string {
  const pack = resolveQualityPack(options);
  return `${buildStoryQualityLineContext(ro, line, pack)}

WARRANTY STORY TO REVIEW:
---
${warrantyStory}
---

Provide ${pack.quality.auditLabel} coaching with specific technicianDetails prompts. priorityActions must be 3-5 specific edits the technician can make now using only available data.`;
}

export function gradeFromScore(score: number): StoryQualityGrade {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'needs-work';
  return 'at-risk';
}

function clampScore(score: unknown): number | null {
  if (typeof score === 'string') {
    const trimmed = score.trim();
    const fraction = trimmed.match(/(\d{1,3})\s*\/\s*100/);
    if (fraction) {
      const parsed = Number(fraction[1]);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(100, Math.round(parsed)));
      }
    }
    const leading = trimmed.match(/^(\d{1,3})\b/);
    if (leading) {
      const parsed = Number(leading[1]);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(100, Math.round(parsed)));
      }
    }
  }

  const n = typeof score === 'number' ? score : Number(score);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function nestedRecordScore(container: unknown): unknown {
  if (!container || typeof container !== 'object' || Array.isArray(container)) return undefined;
  const row = container as Record<string, unknown>;
  return row.score ?? row.qualityScore ?? row.miScore;
}

function extractScoreFromRawText(raw: string): number | null {
  const patterns = [
    /"score"\s*:\s*(\d{1,3})/i,
    /"miScore"\s*:\s*(\d{1,3})/i,
    /"qualityScore"\s*:\s*(\d{1,3})/i,
    /\bscores?\b[^0-9]{0,24}(\d{1,3})\s*(?:\/\s*100)?/i,
    /\b(\d{1,3})\s*\/\s*100\b/,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    const score = clampScore(match[1]);
    if (score !== null) return score;
  }
  return null;
}

function extractScore(parsed: Record<string, unknown>): number | null {
  const candidates = [
    parsed.score,
    parsed.qualityScore,
    parsed.quality_score,
    parsed.miScore,
    parsed.mi_score,
    parsed.overall_score,
    parsed.overallScore,
    nestedRecordScore(parsed.quality),
    nestedRecordScore(parsed.assessment),
    nestedRecordScore(parsed.result),
  ];

  for (const candidate of candidates) {
    const score = clampScore(candidate);
    if (score !== null) return score;
  }

  return null;
}

function buildParseFailureResult(reason: string): StoryQualityResult {
  return {
    score: 0,
    grade: 'at-risk',
    strengths: [],
    improvements: ['Audit could not read the AI score — tap Audit Story again.'],
    auditRisks: ['Score analysis unavailable'],
    technicianDetails: [],
    summary: reason,
    parseFailed: true,
  };
}

function asStringArray(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        return String(row.text ?? row.detail ?? row.message ?? row.description ?? row.item ?? '').trim();
      }
      return String(item).trim();
    })
    .filter((s) => s.length > 0)
    .slice(0, max);
}

function asStringArrayFromFields(parsed: Record<string, unknown>, keys: string[], max = 6): string[] {
  for (const key of keys) {
    const values = asStringArray(parsed[key], max);
    if (values.length > 0) return values;
  }
  return [];
}

function extractTechnicianDetails(parsed: Record<string, unknown>): TechnicianDetailPrompt[] {
  const candidates = [
    parsed.technicianDetails,
    parsed.technician_details,
    parsed.details,
    parsed.actionableFeedback,
    parsed.coaching,
  ];
  for (const candidate of candidates) {
    const details = parseTechnicianDetails(candidate);
    if (details.length > 0) return details;
  }
  return [];
}

export function storyQualityDetailCount(result: StoryQualityResult): number {
  return (
    result.strengths.length +
    result.improvements.length +
    result.auditRisks.length +
    result.technicianDetails.length
  );
}

/** True when score parsed but green/yellow/red coaching sections are all missing. */
export function isStoryQualityDetailMissing(result: StoryQualityResult): boolean {
  if (isStoryQualityParseFailure(result)) return false;
  return storyQualityDetailCount(result) === 0;
}

export function pickRicherStoryQuality(
  primary: StoryQualityResult,
  secondary: StoryQualityResult
): StoryQualityResult {
  if (isStoryQualityParseFailure(primary) && !isStoryQualityParseFailure(secondary)) return secondary;
  if (!isStoryQualityParseFailure(primary) && isStoryQualityParseFailure(secondary)) return primary;
  return storyQualityDetailCount(secondary) > storyQualityDetailCount(primary) ? secondary : primary;
}

function asGrade(value: unknown, score: number): StoryQualityGrade {
  const grades: StoryQualityGrade[] = ['excellent', 'strong', 'needs-work', 'at-risk'];
  if (typeof value === 'string' && grades.includes(value as StoryQualityGrade)) {
    return value as StoryQualityGrade;
  }
  return gradeFromScore(score);
}

const VALID_FIELDS = new Set(['technicianNotes', 'customerConcern', 'diagnostic', 'workflow']);

function parseTechnicianDetails(value: unknown): TechnicianDetailPrompt[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const missing = String(row.missing ?? '').trim();
      const prompt = String(row.prompt ?? '').trim();
      const fieldRaw = String(row.field ?? 'technicianNotes');
      const field = VALID_FIELDS.has(fieldRaw) ? (fieldRaw as TechnicianDetailPrompt['field']) : 'technicianNotes';
      if (!missing && !prompt) return null;
      return { missing: missing || 'Missing detail', prompt: prompt || missing, field };
    })
    .filter((x): x is TechnicianDetailPrompt => x !== null)
    .slice(0, 6);
}

export const STORY_QUALITY_PARSE_FAILURE_SUMMARY = 'Quality analysis could not be completed.';

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function tryParseJsonRecord(payload: string): Record<string, unknown> | null {
  const candidates = [
    payload,
    payload.replace(/,\s*([}\]])/g, '$1'),
    payload.replace(/[\u2018\u2019]/g, "'").replace(/'/g, '"'),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const balanced = extractBalancedJsonObject(trimmed);
  if (balanced) return balanced;

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

function storyQualityParseFailure(): StoryQualityResult {
  return {
    score: 0,
    grade: 'at-risk',
    strengths: [],
    improvements: ['Unable to parse quality score — try reviewing again.'],
    auditRisks: ['Score analysis unavailable'],
    technicianDetails: [],
    summary: STORY_QUALITY_PARSE_FAILURE_SUMMARY,
  };
}

export function isStoryQualityParseFailure(result: StoryQualityResult): boolean {
  return Boolean(result.parseFailed) || result.summary === STORY_QUALITY_PARSE_FAILURE_SUMMARY;
}

export function parseStoryQualityResponse(raw: string): StoryQualityResult {
  if (!raw.trim()) {
    return buildParseFailureResult('AI quality scorer returned an empty response.');
  }

  const payload = extractJsonPayload(raw);
  let parsed = tryParseJsonRecord(payload);
  if (!parsed) {
    const recoveredScore = extractScoreFromRawText(raw);
    if (recoveredScore === null) {
      return buildParseFailureResult('AI quality scorer returned unreadable JSON.');
    }
  return buildParseFailureResult(
      'AI quality scorer returned unreadable JSON — score could not be fully structured.'
    );
  }

  if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
    parsed = parsed[0] as Record<string, unknown>;
  }

  let score = extractScore(parsed);
  if (score === null) {
    score = extractScoreFromRawText(raw);
  }
  if (score === null) {
    return buildParseFailureResult('AI quality scorer response did not include a valid score.');
  }

  const feedback =
    parsed.feedback && typeof parsed.feedback === 'object' && !Array.isArray(parsed.feedback)
      ? (parsed.feedback as Record<string, unknown>)
      : null;

  const strengths = asStringArrayFromFields(parsed, [
    'strengths',
    'strength',
    'positives',
    'whatWasStrong',
    'green',
    'strongPoints',
  ]);
  const improvements = asStringArrayFromFields(parsed, [
    'improvements',
    'improvement',
    'suggestions',
    'areasForImprovement',
    'yellow',
    'polish',
    'improve',
  ]);
  const auditRisks = asStringArrayFromFields(parsed, [
    'auditRisks',
    'audit_risks',
    'risks',
    'criticalIssues',
    'rejectionRisks',
    'red',
    'critical',
  ]);

  return {
    score,
    grade: asGrade(parsed.grade, score),
    strengths:
      strengths.length > 0
        ? strengths
        : feedback
          ? asStringArrayFromFields(feedback, ['strengths', 'structure', 'clarity'])
          : [],
    improvements:
      improvements.length > 0
        ? improvements
        : feedback
          ? asStringArrayFromFields(feedback, ['improvements', 'workflow', 'technicalDetail'])
          : [],
    auditRisks:
      auditRisks.length > 0
        ? auditRisks
        : feedback
          ? asStringArrayFromFields(feedback, ['auditRisks', 'fabricationRisk', 'risks'])
          : [],
    technicianDetails: extractTechnicianDetails(parsed),
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : 'Quality assessment complete.',
    parseFailed: false,
  };
}

export function parseStoryReviewResponse(raw: string): StoryReviewResult {
  const payload = extractJsonPayload(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    const fallback = parseStoryQualityResponse(raw);
    return {
      ...fallback,
      feedback: {
        structure: 'Review could not be parsed — try again.',
        technicalDetail: '',
        clarity: '',
        workflow: '',
        fabricationRisk: '',
      },
      priorityActions: ['Re-run Review with AI'],
    };
  }

  const quality = parseStoryQualityResponse(payload);
  const feedbackRaw = (parsed.feedback ?? {}) as Record<string, unknown>;

  return {
    ...quality,
    feedback: {
      structure: String(feedbackRaw.structure ?? '').trim() || 'No structure feedback.',
      technicalDetail: String(feedbackRaw.technicalDetail ?? '').trim() || 'No technical detail feedback.',
      clarity: String(feedbackRaw.clarity ?? '').trim() || 'No clarity feedback.',
      workflow: String(feedbackRaw.workflow ?? '').trim() || 'No workflow feedback.',
      fabricationRisk: String(feedbackRaw.fabricationRisk ?? '').trim() || 'No fabrication risk noted.',
    },
    priorityActions: asStringArray(parsed.priorityActions, 5),
  };
}