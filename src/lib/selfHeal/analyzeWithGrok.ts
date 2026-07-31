import 'server-only';

import { getGrokApiKey } from '@/lib/grokApiKey.shared';
import { logger } from '@/lib/logger';

const GROK_CHAT_URL = 'https://api.x.ai/v1/chat/completions';
const MODEL = process.env.GROK_SELF_HEAL_MODEL?.trim() || 'grok-3-mini';

export interface SelfHealAnalysisInput {
  healthServices: Record<string, { status: string; operatorMessage?: string; latencyMs?: number }>;
  criticalFails: string[];
  warnings: string[];
  window: { timezone: string; localHour: number; phase: string };
  previousSummary?: string | null;
}

export interface SelfHealAnalysisResult {
  summary: string;
  recommendations: string[];
  model: string;
}

/**
 * Ask Grok for operator-facing remediation steps only.
 * Never requests code patches or secrets. Fail-closed to empty on error.
 */
export async function analyzeHealthWithGrok(
  input: SelfHealAnalysisInput
): Promise<SelfHealAnalysisResult | null> {
  const apiKey = getGrokApiKey();
  if (!apiKey) {
    logger.warn('self_heal.grok_missing_key');
    return null;
  }

  const system = [
    'You are Merlinus platform ops assistant for a Mercedes-Benz dealership OS on Cloudflare.',
    'Given health probe results, produce concise operator guidance.',
    'Rules:',
    '- Never invent secrets, credentials, or URLs with tokens.',
    '- Never propose deleting customer data or disabling tenant isolation.',
    '- Prefer: check Worker bindings (KV_STORE, DB, APEX_R2, AI_JOBS_QUEUE), secrets, queue consumer, MFA enrollment.',
    '- Output strict JSON: {"summary":"string","recommendations":["string",...]} max 6 recommendations.',
  ].join(' ');

  const user = JSON.stringify({
    criticalFails: input.criticalFails,
    warnings: input.warnings,
    services: input.healthServices,
    window: input.window,
    previousSummary: input.previousSummary || null,
  });

  try {
    const res = await fetch(GROK_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      logger.warn('self_heal.grok_http_error', { status: res.status });
      return null;
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content?.trim() || '';
    if (!content) return null;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        summary: content.slice(0, 400),
        recommendations: [],
        model: MODEL,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      summary?: string;
      recommendations?: unknown;
    };
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
          .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
          .slice(0, 6)
      : [];

    return {
      summary: (parsed.summary || content).slice(0, 800),
      recommendations,
      model: MODEL,
    };
  } catch (error) {
    logger.warn('self_heal.grok_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
