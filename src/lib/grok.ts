import {
  getGrokApiKey,
  getGrokApiKeyForSlot,
  getGrokProxyApiKey,
  getGrokProxyBaseUrl,
  isGrokProxyConfigured,
  type GrokKeySlot,
} from '@/lib/grokApiKey.shared';
import { createGrokProxyAccessToken } from '@/lib/grokProxyAuth';
import { GROK_CHAT_MODEL, GROK_STORY_MODEL, GROK_STORY_REVIEW_MODEL } from '@/lib/grokModels';
import { DIAGNOSTIC_EXTRACTION_PROMPT } from '@/prompts/diagnosticExtraction';
import { RO_EXTRACTION_PROMPT } from '@/prompts/roExtraction';
import {
  getStoryReviewSystemPrompt,
  getStoryScoreRetrySystemPrompt,
  getStoryScoreSystemPrompt,
  buildStoryReviewUserMessage,
  buildStoryScoreUserMessage,
  isStoryQualityDetailMissing,
  isStoryQualityParseFailure,
  parseStoryQualityResponse,
  pickRicherStoryQuality,
  parseStoryReviewResponse,
  reconcileStoryQualityWithAppliedCorrections,
  type StoryQualityResult,
  type StoryReviewResult,
} from '@/prompts/storyQuality';
import {
  CUSTOMER_PAY_DYNAMIC_SYSTEM_PROMPT,
  buildCustomerPayDynamicUserMessage,
} from '@/prompts/customerPayDynamic';
import { PROMPT_VERSION } from '@/prompts/version';
import {
  DEFAULT_STORY_BRAND,
  resolveStoryBrandPack,
  type StoryBrandId,
  type StoryBrandPack,
} from '@/prompts/story';
import {
  WARRANTY_STORY_MAX_TOKENS,
  WARRANTY_STORY_REGENERATE_TEMPERATURE,
  WARRANTY_STORY_TEMPERATURE,
  buildWarrantyStoryUserMessage,
  getStorySystemPrompt,
  shouldRegenerateStory,
} from '@/prompts/warrantyStory';

export { PROMPT_VERSION };
import type { ExtractedData, RepairLine, RepairOrder } from '@/types';
import { normalizeExtractedData, parseDiagnosticExtractionJson } from '@/utils/diagnosticParser';
import { logPerformance } from '@/lib/perf';
import {
  DIAGNOSTIC_EXTRACT_GROK_MS,
  RO_EXTRACT_GROK_MS,
  STORY_GENERATE_GROK_MS,
  STORY_REVIEW_GROK_MS,
  STORY_SCORE_GROK_MS,
} from '@/lib/timeouts';
import { parseStructuredROText } from '@/utils/roExtractor';
import { logger } from '@/lib/logger';
import { parseGrokApiErrorBody } from '@/lib/scanRouteErrors';

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

export { GROK_CHAT_MODEL, GROK_STORY_MODEL };

/** Full MI audit JSON (score + strengths + improvements + risks + technicianDetails). */
export const WARRANTY_STORY_SCORE_MAX_TOKENS = 1_400;

function assertGrokServerRuntime(caller: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(`${caller} is only available on the server`);
  }
}

/**
 * Use the centralized Grok proxy only for dealer nodes that lack a local xAI key
 * (or that explicitly set GROK_PROXY_URL to a remote host).
 *
 * Hosts with GROK_API_KEY call api.x.ai directly — GROK_PROXY_API_KEY alone is for
 * *inbound* /api/grok/proxy auth, not for looping server→self (which 401s under
 * Vercel Deployment Protection and static-bearer-disabled policy).
 */
function shouldUseApexGrokProxy(): boolean {
  if (!isGrokProxyConfigured()) return false;
  const remoteProxy = Boolean(getGrokProxyBaseUrl());
  try {
    getGrokApiKey();
    // Local xAI key present: only use proxy when an explicit remote base is configured.
    return remoteProxy;
  } catch {
    // No local GROK_API_KEY — dealer node must use the proxy.
    return true;
  }
}

function resolveApexGrokProxyEndpoint(): string {
  const configuredBase = getGrokProxyBaseUrl();
  if (configuredBase) {
    return `${configuredBase}/api/grok/proxy`;
  }
  const vercelHost = process.env.VERCEL_URL?.trim();
  const base =
    process.env.MERLIN_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (vercelHost ? `https://${vercelHost}` : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}/api/grok/proxy`;
}

export function isGrokConfigured(): boolean {
  if (isGrokProxyConfigured()) return true;
  try {
    getGrokApiKey();
    return true;
  } catch {
    return false;
  }
}

export type GrokReasoningEffort = 'none' | 'low' | 'medium' | 'high';

function extractGrokMessageContent(apiResponse: unknown): string {
  const choices = (apiResponse as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> })
    ?.choices;
  const choice = choices?.[0];
  if (!choice) return '';

  const messageContent = choice.message?.content;
  if (typeof messageContent === 'string') return messageContent.trim();
  if (Array.isArray(messageContent)) {
    const textParts = messageContent
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const row = part as { type?: string; text?: string };
        return row.type === 'text' && typeof row.text === 'string' ? row.text : '';
      })
      .filter(Boolean);
    if (textParts.length) return textParts.join('\n').trim();
  }

  if (typeof choice.text === 'string') return choice.text.trim();
  return '';
}

type GrokChatOptions = {
  temperature: number;
  max_tokens: number;
  timeoutMs?: number;
  perfLabel?: string;
  model?: string;
  /** Only sent for grok-4.x models — grok-3 ignores reasoning. */
  reasoningEffort?: GrokReasoningEffort;
  /** Request JSON object output from the chat API when supported. */
  responseFormat?: 'json_object';
  /**
   * Which Worker secret slot to use for direct xAI calls.
   * default = GROK_API_KEY, vision = GROK_API_KEY_1, voice = GROK_API_KEY_2.
   * Proxy transport still uses the Apex proxy auth path (not per-slot).
   */
  keySlot?: GrokKeySlot;
};

type GrokChatMessage = {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

function buildGrokChatRequestBody(
  messages: GrokChatMessage[],
  options: GrokChatOptions
): { requestBody: Record<string, unknown>; model: string; reasoningEffort: GrokReasoningEffort } {
  const model = options.model ?? GROK_CHAT_MODEL;
  const reasoningEffort = options.reasoningEffort ?? 'none';
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
  };
  if (model.includes('grok-4') && !model.includes('non-reasoning')) {
    requestBody.reasoning_effort = reasoningEffort;
  }
  if (options.responseFormat === 'json_object') {
    requestBody.response_format = { type: 'json_object' };
  }
  return { requestBody, model, reasoningEffort };
}

async function parseGrokChatResponse(
  response: Response,
  context: { perfLabel?: string; model: string; reasoningEffort: GrokReasoningEffort; maxTokens: number }
): Promise<string> {
  if (!response.ok) {
    const errBody = await response.text();
    const detail = parseGrokApiErrorBody(errBody);
    logger.warn('grok.api_error', {
      status: response.status,
      bodyLength: errBody.length,
      detail: detail || undefined,
      perfLabel: context.perfLabel,
      model: context.model,
    });
    const suffix = detail ? ` — ${detail}` : '';
    throw new Error(`Grok API error: ${response.status}${suffix}`);
  }

  const apiResponse = await response.json();
  return extractGrokMessageContent(apiResponse);
}

/** Apex national platform — route Grok chat through the centralized proxy when configured. */
async function grokChatViaApexProxy(
  messages: GrokChatMessage[],
  options: GrokChatOptions,
  requestBody: Record<string, unknown>,
  context: { model: string; reasoningEffort: GrokReasoningEffort; timeoutMs: number; startedAt: number }
): Promise<string> {
  const proxyKey = getGrokProxyApiKey();
  if (!proxyKey) {
    throw new Error('GROK_PROXY_API_KEY is not configured');
  }

  // Proxy route rejects static bearer unless GROK_PROXY_ALLOW_STATIC_BEARER=true.
  // Always mint short-lived HMAC tokens (Phase 6.2/6.4 fortress policy).
  const accessToken = createGrokProxyAccessToken(60, proxyKey);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  // Same-project or protected preview/prod: bypass Vercel Deployment Protection when configured.
  const bypass =
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ||
    process.env.GROK_PROXY_VERCEL_BYPASS_SECRET?.trim();
  if (bypass) {
    headers['x-vercel-protection-bypass'] = bypass;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);

  try {
    const response = await fetch(resolveApexGrokProxyEndpoint(), {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const content = await parseGrokChatResponse(response, {
      perfLabel: options.perfLabel,
      model: context.model,
      reasoningEffort: context.reasoningEffort,
      maxTokens: options.max_tokens,
    });
    logPerformance(options.perfLabel || 'grok.chat.proxy', Date.now() - context.startedAt, {
      model: context.model,
      maxTokens: options.max_tokens,
      reasoningEffort: context.model.includes('grok-4') ? context.reasoningEffort : 'n/a',
      outcome: 'ok',
      transport: 'apex_proxy',
    });
    return content;
  } catch (error) {
    logPerformance(options.perfLabel || 'grok.chat.proxy', Date.now() - context.startedAt, {
      model: context.model,
      outcome: 'error',
      error: error instanceof Error ? error.message : 'unknown',
      transport: 'apex_proxy',
    });
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Grok proxy timed out after ${Math.round(context.timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Direct xAI chat completions — key selected by options.keySlot (default / vision / voice). */
async function grokChatDirect(
  options: GrokChatOptions,
  requestBody: Record<string, unknown>,
  context: { model: string; reasoningEffort: GrokReasoningEffort; timeoutMs: number; startedAt: number }
): Promise<string> {
  const keySlot: GrokKeySlot = options.keySlot ?? 'default';
  const apiKey = getGrokApiKeyForSlot(keySlot);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);

  try {
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const content = await parseGrokChatResponse(response, {
      perfLabel: options.perfLabel,
      model: context.model,
      reasoningEffort: context.reasoningEffort,
      maxTokens: options.max_tokens,
    });
    logPerformance(options.perfLabel || 'grok.chat', Date.now() - context.startedAt, {
      model: context.model,
      maxTokens: options.max_tokens,
      reasoningEffort: context.model.includes('grok-4') ? context.reasoningEffort : 'n/a',
      outcome: 'ok',
      transport: 'direct',
      keySlot,
    });
    return content;
  } catch (error) {
    logPerformance(options.perfLabel || 'grok.chat', Date.now() - context.startedAt, {
      model: context.model,
      outcome: 'error',
      error: error instanceof Error ? error.message : 'unknown',
      transport: 'direct',
      keySlot,
    });
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Grok API timed out after ${Math.round(context.timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function grokChat(messages: GrokChatMessage[], options: GrokChatOptions): Promise<string> {
  assertGrokServerRuntime('grokChat');
  const timeoutMs = options.timeoutMs ?? 55_000;
  const startedAt = Date.now();
  const { requestBody, model, reasoningEffort } = buildGrokChatRequestBody(messages, options);
  const context = { model, reasoningEffort, timeoutMs, startedAt };

  if (shouldUseApexGrokProxy()) {
    return grokChatViaApexProxy(messages, options, requestBody, context);
  }
  return grokChatDirect(options, requestBody, context);
}

export interface GenerateDynamicCustomerPayNarrativeInput {
  templateTitle: string;
  baseTemplate: string;
  customerComplaint: string;
}

const CUSTOMER_PAY_DYNAMIC_MAX_TOKENS = 900;
const CUSTOMER_PAY_DYNAMIC_TIMEOUT_MS = 25_000;
const CUSTOMER_PAY_MIN_TOKEN_VARIATION = 0.08;

function tokenizeForVariationCheck(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function customerPayNarrativeHasMinimumVariation(baseTemplate: string, candidate: string): boolean {
  const normalizedBase = baseTemplate.trim().toLowerCase();
  const normalizedCandidate = candidate.trim().toLowerCase();
  if (!normalizedCandidate || normalizedCandidate === normalizedBase) return false;

  const baseTokens = tokenizeForVariationCheck(baseTemplate);
  const candidateTokens = tokenizeForVariationCheck(candidate);
  if (baseTokens.size === 0) return normalizedCandidate !== normalizedBase;

  let shared = 0;
  for (const token of baseTokens) {
    if (candidateTokens.has(token)) shared += 1;
  }
  const overlapRatio = shared / baseTokens.size;
  return overlapRatio <= 1 - CUSTOMER_PAY_MIN_TOKEN_VARIATION;
}

function customerPayNarrativeToneOk(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length < 40) return false;
  if (/[{}\[\]"]/.test(trimmed)) return false;
  return /^Performed\b/i.test(trimmed);
}

/**
 * Light Grok rewrite of a Customer Pay base template using the scanned customer complaint.
 * Falls back to the base template when Grok is unavailable or output fails guardrails.
 */
export async function generateDynamicCustomerPayNarrative(
  input: GenerateDynamicCustomerPayNarrativeInput
): Promise<string> {
  const baseTemplate = input.baseTemplate?.trim() ?? '';
  if (!baseTemplate) return baseTemplate;

  if (!isGrokConfigured()) {
    return baseTemplate;
  }

  const userMessage = buildCustomerPayDynamicUserMessage(input);
  const attempts: Array<{ temperature: number; perfLabel: string }> = [
    { temperature: 0.35, perfLabel: 'grok.customer_pay.dynamic' },
    { temperature: 0.5, perfLabel: 'grok.customer_pay.dynamic_retry' },
  ];

  for (const attempt of attempts) {
    try {
      const raw = await grokChat(
        [
          { role: 'system', content: CUSTOMER_PAY_DYNAMIC_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        {
          model: GROK_STORY_MODEL,
          temperature: attempt.temperature,
          max_tokens: CUSTOMER_PAY_DYNAMIC_MAX_TOKENS,
          timeoutMs: CUSTOMER_PAY_DYNAMIC_TIMEOUT_MS,
          perfLabel: attempt.perfLabel,
        }
      );
      const candidate = raw?.trim() ?? '';
      if (
        customerPayNarrativeToneOk(candidate) &&
        customerPayNarrativeHasMinimumVariation(baseTemplate, candidate)
      ) {
        return candidate;
      }
    } catch (error) {
      logger.warn('grok.customer_pay.dynamic_failed', {
        templateTitle: input.templateTitle,
        error: error instanceof Error ? error.message : 'unknown',
        perfLabel: attempt.perfLabel,
      });
      break;
    }
  }

  return baseTemplate;
}

export type StoryAiOptions = {
  brand?: StoryBrandId | string | null;
  pack?: StoryBrandPack;
  /** Technician preferred language for notes; story output is always English. */
  preferredLanguage?: string | null;
};

function resolveStoryAiPack(options?: StoryAiOptions): StoryBrandPack {
  return (
    options?.pack ??
    resolveStoryBrandPack(options?.brand ?? DEFAULT_STORY_BRAND, { preferDefaultMercedes: true })
  );
}

export async function generateWarrantyStory(
  ro: RepairOrder,
  line: RepairLine,
  options?: StoryAiOptions
): Promise<string> {
  const pack = resolveStoryAiPack(options);
  const priorStory = line.warrantyStory?.trim() ?? '';
  const isRegen = shouldRegenerateStory(line, { mode: 'auto' });
  const {
    applyCorrectionsToStoryDeterministically,
    ensureStoryPreservesPriorAndCorrections,
    extractRequiredCorrectionsFromNotes,
  } = await import('@/lib/storyRegenerateGuard');
  const corrections = extractRequiredCorrectionsFromNotes(line.technicianNotes || '');

  // --- REVISION PATH: deterministic editor first (reliable score lifts) ---
  // When the tech already has a story + pending audit corrections, always produce a
  // stronger draft by integrating corrections into the existing narrative. Optional AI
  // polish may improve prose, but must never leave us without a successful revision.
  if (isRegen && priorStory && corrections.length > 0) {
    const deterministic = applyCorrectionsToStoryDeterministically(priorStory, corrections);
    try {
      const userMessage = buildWarrantyStoryUserMessage(ro, line, {
        pack,
        mode: 'regenerate',
        priorStory: deterministic,
        preferredLanguage: options?.preferredLanguage,
      });
      const systemPrompt = getStorySystemPrompt(pack.id, { regenerate: true, line });
      const polished = await grokChat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        {
          model: GROK_STORY_MODEL,
          temperature: WARRANTY_STORY_REGENERATE_TEMPERATURE,
          max_tokens: WARRANTY_STORY_MAX_TOKENS,
          timeoutMs: STORY_GENERATE_GROK_MS,
          perfLabel: 'grok.story.regenerate',
        }
      );
      const trimmed = polished?.trim();
      if (trimmed) {
        return ensureStoryPreservesPriorAndCorrections(deterministic, trimmed, corrections);
      }
    } catch (error) {
      logger.warn('grok.story.regenerate_ai_skipped_using_deterministic', {
        error: error instanceof Error ? error.message : 'unknown',
        correctionCount: corrections.length,
        priorChars: priorStory.length,
      });
    }
    return deterministic;
  }

  // --- FIRST PASS (or regen without structured corrections) ---
  const userMessage = buildWarrantyStoryUserMessage(ro, line, {
    pack,
    mode: isRegen ? 'regenerate' : 'generate',
    preferredLanguage: options?.preferredLanguage,
  });
  const systemPrompt = isRegen
    ? getStorySystemPrompt(pack.id, { regenerate: true, line })
    : pack.systemPrompt;

  const story = await grokChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    {
      model: GROK_STORY_MODEL,
      temperature: isRegen ? WARRANTY_STORY_REGENERATE_TEMPERATURE : WARRANTY_STORY_TEMPERATURE,
      max_tokens: WARRANTY_STORY_MAX_TOKENS,
      timeoutMs: STORY_GENERATE_GROK_MS,
      perfLabel: isRegen ? 'grok.story.regenerate' : 'grok.story.generate',
    }
  );
  let trimmed = story?.trim();
  if (!trimmed) {
    if (isRegen && priorStory) {
      return applyCorrectionsToStoryDeterministically(priorStory, corrections);
    }
    throw new Error('AI did not return a warranty story. Try again or type the story manually.');
  }
  if (isRegen && priorStory) {
    trimmed = ensureStoryPreservesPriorAndCorrections(priorStory, trimmed, corrections);
  }
  return trimmed;
}

async function requestStoryQualityScore(
  ro: RepairOrder,
  line: RepairLine,
  warrantyStory: string,
  systemPrompt: string,
  perfLabel: string,
  pack: StoryBrandPack
): Promise<StoryQualityResult> {
  const raw = await grokChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildStoryScoreUserMessage(ro, line, warrantyStory, { pack }) },
    ],
    {
      model: GROK_STORY_MODEL,
      temperature: 0.1,
      max_tokens: WARRANTY_STORY_SCORE_MAX_TOKENS,
      timeoutMs: STORY_SCORE_GROK_MS,
      perfLabel,
      responseFormat: 'json_object',
    }
  );
  if (!raw.trim()) {
    logger.warn('grok.story.score_empty_response', { perfLabel, model: GROK_STORY_MODEL });
  }
  const parsed = parseStoryQualityResponse(raw);
  // Credit Add Tech Details / pending corrections even when the model rephrases the same gaps.
  return reconcileStoryQualityWithAppliedCorrections(
    parsed,
    warrantyStory,
    line.technicianNotes || ''
  );
}

export async function scoreWarrantyStory(
  ro: RepairOrder,
  line: RepairLine,
  warrantyStory: string,
  options?: StoryAiOptions
): Promise<StoryQualityResult> {
  const pack = resolveStoryAiPack(options);
  const first = await requestStoryQualityScore(
    ro,
    line,
    warrantyStory,
    getStoryScoreSystemPrompt({ pack }),
    'grok.story.score',
    pack
  );
  const firstOk =
    !isStoryQualityParseFailure(first) && !isStoryQualityDetailMissing(first);
  if (firstOk) return first;

  logger.warn('grok.story.score_retry', {
    summary: first.summary,
    reason: isStoryQualityParseFailure(first) ? 'parse_failed' : 'missing_detail',
    detailCount: first.strengths.length + first.improvements.length + first.auditRisks.length,
  });
  const retry = await requestStoryQualityScore(
    ro,
    line,
    warrantyStory,
    getStoryScoreRetrySystemPrompt({ pack }),
    'grok.story.score_retry',
    pack
  );
  const best = pickRicherStoryQuality(first, retry);
  const bestOk =
    !isStoryQualityParseFailure(best) && !isStoryQualityDetailMissing(best);
  if (bestOk) return best;

  logger.error('grok.story.score_parse_failed', {
    summary: best.summary,
    firstSummary: first.summary,
    retrySummary: retry.summary,
    detailCount:
      best.strengths.length +
      best.improvements.length +
      best.auditRisks.length +
      best.technicianDetails.length,
  });
  return best;
}

export async function reviewWarrantyStory(
  ro: RepairOrder,
  line: RepairLine,
  warrantyStory: string,
  options?: StoryAiOptions
): Promise<StoryReviewResult> {
  const pack = resolveStoryAiPack(options);
  const raw = await grokChat(
    [
      { role: 'system', content: getStoryReviewSystemPrompt({ pack }) },
      { role: 'user', content: buildStoryReviewUserMessage(ro, line, warrantyStory, { pack }) },
    ],
    {
      model: GROK_STORY_REVIEW_MODEL,
      temperature: 0.15,
      max_tokens: 1400,
      timeoutMs: STORY_REVIEW_GROK_MS,
      perfLabel: 'grok.story.review',
      reasoningEffort: 'none',
      responseFormat: 'json_object',
    }
  );
  const parsed = parseStoryReviewResponse(raw);
  if (parsed.parseFailed) {
    logger.error('grok.story.review_parse_failed', {
      rawLength: raw.length,
      rawPreview: raw.slice(0, 500),
      summary: parsed.summary,
    });
  }
  return parsed;
}

/**
 * Customer video inspection report — separate from warranty story generation.
 * Multimodal: system + user text + optional still-frame image_url parts.
 */
export async function generateCustomerVideoReport(input: {
  transcript: string;
  transcriptLanguage?: string | null;
  vehicleLabel?: string | null;
  dealershipName?: string | null;
  title?: string | null;
  /** Vision data URLs (JPEG/PNG) — client keyframes. Max ~8 used. */
  frameDataUrls?: string[];
}): Promise<string> {
  assertGrokServerRuntime('generateCustomerVideoReport');
  const { CUSTOMER_VIDEO_REPORT_SYSTEM_PROMPT } = await import(
    '@/prompts/customerVideoReport/systemPrompt'
  );
  const { buildCustomerVideoReportUserMessage } = await import(
    '@/prompts/customerVideoReport/buildUserMessage'
  );
  const { CUSTOMER_VIDEO_REPORT_GROK_MS } = await import('@/lib/timeouts');

  const frames = (input.frameDataUrls ?? []).filter(Boolean).slice(0, 8);
  const userText = buildCustomerVideoReportUserMessage({
    transcript: input.transcript,
    transcriptLanguage: input.transcriptLanguage,
    vehicleLabel: input.vehicleLabel,
    dealershipName: input.dealershipName,
    title: input.title,
    frameCount: frames.length,
  });

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: userText },
    ...frames.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];

  const model =
    process.env.GROK_CUSTOMER_REPORT_MODEL?.trim() || GROK_CHAT_MODEL;

  const report = await grokChat(
    [
      { role: 'system', content: CUSTOMER_VIDEO_REPORT_SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    {
      model,
      temperature: 0.35,
      max_tokens: 2048,
      timeoutMs: CUSTOMER_VIDEO_REPORT_GROK_MS,
      perfLabel: 'grok.customer_video_report',
    }
  );

  const trimmed = report?.trim();
  if (!trimmed) {
    throw new Error('AI did not return a customer inspection report. Try again.');
  }
  return trimmed;
}

export async function extractDiagnosticsFromImage(imageDataUrl: string): Promise<ExtractedData> {
  const raw = await grokChat(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: DIAGNOSTIC_EXTRACTION_PROMPT },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    {
      temperature: 0.05,
      max_tokens: 900,
      timeoutMs: DIAGNOSTIC_EXTRACT_GROK_MS,
      perfLabel: 'grok.diagnostics.extract',
      keySlot: 'vision',
    }
  );

  const parsed = parseDiagnosticExtractionJson(raw);
  if (!parsed) {
    throw new Error('Could not parse diagnostic extraction from Grok response');
  }
  return normalizeExtractedData(parsed);
}

export async function extractROFromImages(imageDataUrls: string[]) {
  const imageContents = imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } }));
  const extractedText = await grokChat(
    [
      {
        role: 'user',
        content: [{ type: 'text', text: RO_EXTRACTION_PROMPT }, ...imageContents],
      },
    ],
    {
      temperature: 0.05,
      max_tokens: 2200,
      timeoutMs: RO_EXTRACT_GROK_MS,
      perfLabel: 'grok.ro.extract',
      reasoningEffort: 'none',
      keySlot: 'vision',
    }
  );
  return parseStructuredROText(extractedText);
}