/**
 * AI conversation summarization + key-point extraction for the Hub.
 */

import 'server-only';

import { getGrokApiKeyForSlot } from '@/lib/grokApiKey.shared';
import { GROK_CHAT_MODEL } from '@/lib/grokModels';
import { logger } from '@/lib/logger';
import { HUB_INSIGHT_PROMPT_VERSION } from '@/lib/hub/constants';

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

export type HubInsightResult = {
  summary: string;
  keyPoints: string[];
  sentiment: string;
  primaryIntent: string;
  suggestedAppointment: {
    title?: string;
    category?: string;
    preferredWindow?: string;
    notes?: string;
  } | null;
  outcome: string | null;
  promptVersion: string;
};

export async function generateConversationInsight(input: {
  dealershipName: string;
  transcript: string;
  metrics?: Record<string, unknown> | null;
  slots?: Record<string, unknown> | null;
}): Promise<HubInsightResult> {
  const transcript = input.transcript.trim().slice(0, 12_000);
  if (!transcript) {
    return {
      summary: 'No transcript available for this conversation.',
      keyPoints: [],
      sentiment: 'neutral',
      primaryIntent: 'unknown',
      suggestedAppointment: null,
      outcome: null,
      promptVersion: HUB_INSIGHT_PROMPT_VERSION,
    };
  }

  const system = `You are an operations analyst for ${input.dealershipName}, a Mercedes-Benz dealership.
Read the phone transcript (Sophia AI receptionist and/or staff) and return ONLY valid JSON:
{
  "summary": "2-4 sentence plain English summary for managers",
  "keyPoints": ["up to 6 short bullets"],
  "sentiment": "neutral|positive|frustrated|urgent|confused",
  "primaryIntent": "short snake_case intent e.g. service_appointment",
  "suggestedAppointment": null or {
    "title": string,
    "category": "service|sales|parts|loaner|other",
    "preferredWindow": string,
    "notes": string
  },
  "outcome": "resolved_by_agent|staff_followup|transferred_human|abandoned|incomplete|null"
}
Rules: never invent VINs, prices, or promises not in the transcript. Prefer actionable next steps.`;

  const user = `Metrics: ${JSON.stringify(input.metrics || {})}
Slots: ${JSON.stringify(input.slots || {})}

Transcript:
${transcript}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const res = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        // Hub insights use default slot (GROK_API_KEY), not vision/voice.
        Authorization: `Bearer ${getGrokApiKeyForSlot('default')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROK_HUB_MODEL?.trim() || GROK_CHAT_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: 900,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text();
      logger.warn('hub.insight_grok_error', { status: res.status, bodyLength: body.length });
      throw new Error(`Grok insight failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() || '';
    const jsonText = extractJson(raw);
    const parsed = JSON.parse(jsonText) as Partial<HubInsightResult>;

    return {
      summary: String(parsed.summary || 'Conversation reviewed.').slice(0, 4000),
      keyPoints: Array.isArray(parsed.keyPoints)
        ? parsed.keyPoints.map(String).slice(0, 8)
        : [],
      sentiment: String(parsed.sentiment || 'neutral').slice(0, 40),
      primaryIntent: String(parsed.primaryIntent || 'unknown').slice(0, 80),
      suggestedAppointment:
        parsed.suggestedAppointment && typeof parsed.suggestedAppointment === 'object'
          ? (parsed.suggestedAppointment as HubInsightResult['suggestedAppointment'])
          : null,
      outcome: parsed.outcome ? String(parsed.outcome).slice(0, 40) : null,
      promptVersion: HUB_INSIGHT_PROMPT_VERSION,
    };
  } catch (error) {
    logger.warn('hub.insight_fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Deterministic fallback from metrics/slots
    const metrics = input.metrics || {};
    const slots = input.slots || {};
    const summaryFromMetrics =
      typeof metrics.callSummary === 'string' && metrics.callSummary.trim()
        ? String(metrics.callSummary)
        : `Phone conversation for ${input.dealershipName}. Review transcript for details.`;
    return {
      summary: summaryFromMetrics.slice(0, 4000),
      keyPoints: [
        slots.subject ? `Subject: ${String(slots.subject)}` : null,
        slots.customerName ? `Caller: ${String(slots.customerName)}` : null,
        metrics.primaryIntent ? `Intent: ${String(metrics.primaryIntent)}` : null,
      ].filter(Boolean) as string[],
      sentiment: String(metrics.sentiment || slots.sentiment || 'neutral'),
      primaryIntent: String(metrics.primaryIntent || slots.primaryIntent || 'unknown'),
      suggestedAppointment: null,
      outcome: metrics.outcome ? String(metrics.outcome) : null,
      promptVersion: `${HUB_INSIGHT_PROMPT_VERSION}+fallback`,
    };
  }
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}
