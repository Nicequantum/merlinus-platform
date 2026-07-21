/**
 * Hub call ingest pipeline — runs after a voice call completes.
 * Auto-generates ConversationInsight, tags, and hub audit so every Sophia call
 * appears on the Unified Calendar & Conversation Hub with AI intelligence.
 */

import 'server-only';

import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { decryptSensitiveText, encryptSensitiveText } from '@/lib/encryption';
import { writeHubAudit } from '@/lib/hub/audit';
import { generateConversationInsight } from '@/lib/hub/insightAi';
import { logger } from '@/lib/logger';
import { isModuleEnabled } from '@/lib/modules/entitlements';
import { categorizeCall, getVoiceAgent } from '@/lib/voiceAgent/registry';
import { parseConversationState } from '@/lib/voiceAgent/runtime';

export type IngestCallResult = {
  ok: boolean;
  insightId?: string;
  skipped?: boolean;
  error?: string;
};

/**
 * Idempotent: upserts ConversationInsight for the call.
 * Safe to call from status callback and end_call path.
 */
export async function ingestCompletedCallToHub(input: {
  callId?: string;
  callSid?: string;
  /** When true, skip if insight already exists (default true for status retries) */
  skipIfExists?: boolean;
}): Promise<IngestCallResult> {
  try {
    return await withRlsBypass(async () => {
      const db = getRlsDb();
      const call = input.callId
        ? await db.voiceCall.findUnique({
            where: { id: input.callId },
            include: {
              conversation: true,
              segments: { orderBy: { createdAt: 'asc' }, take: 250 },
              dealership: { select: { name: true } },
            },
          })
        : input.callSid
          ? await db.voiceCall.findUnique({
              where: { externalCallId: input.callSid },
              include: {
                conversation: true,
                segments: { orderBy: { createdAt: 'asc' }, take: 250 },
                dealership: { select: { name: true } },
              },
            })
          : null;

      if (!call) {
        return { ok: false, error: 'call_not_found' };
      }

      // Modular: only enrich Hub when calendar_hub is enabled for the rooftop
      const hubOn = await isModuleEnabled(call.dealershipId, 'calendar_hub', { db });
      if (!hubOn) {
        return { ok: true, skipped: true, error: 'calendar_hub_disabled' };
      }

      const existing = await db.conversationInsight.findUnique({
        where: { voiceCallId: call.id },
      });
      if (existing && input.skipIfExists !== false) {
        return { ok: true, insightId: existing.id, skipped: true };
      }

      let transcript = decryptSensitiveText(call.transcriptEncrypted || '');
      if (!transcript && call.segments.length) {
        transcript = call.segments
          .map((s) => {
            const body = decryptSensitiveText(s.textEncrypted || '');
            return `[${s.speaker}${s.agentName ? `:${s.agentName}` : ''}] ${body}`;
          })
          .join('\n');
      }

      let metrics: Record<string, unknown> = {};
      try {
        metrics = JSON.parse(call.metricsJson || '{}') as Record<string, unknown>;
      } catch {
        metrics = {};
      }
      const state = parseConversationState(call.conversation?.stateJson);
      const slots = (state.slots || {}) as Record<string, unknown>;
      const routingPath = (() => {
        try {
          const p = JSON.parse(call.routingPathJson || '[]') as unknown;
          return Array.isArray(p) ? p.map(String) : state.routingPath || [];
        } catch {
          return state.routingPath || [];
        }
      })();

      const insight = await generateConversationInsight({
        dealershipName: call.dealership.name,
        transcript,
        metrics,
        slots,
      });

      // Enrich with registry tags + customer/vehicle linkage from slots
      const tags = categorizeCall({
        primaryIntent: insight.primaryIntent || (slots.primaryIntent as string),
        routingPath,
        outcome: insight.outcome || call.outcome,
        slots,
      });

      const suggested = {
        ...(insight.suggestedAppointment || {}),
        customerName: slots.customerName || undefined,
        customerPhone: slots.customerPhone || undefined,
        vehicleLabel: slots.vehicleLabel || undefined,
        vin: slots.vin || undefined,
        voiceCallId: call.id,
        tags,
        agentDisplayName:
          (typeof metrics.agentDisplayName === 'string' && metrics.agentDisplayName) ||
          getVoiceAgent(call.conversation?.activeAgent || 'receptionist')?.displayName ||
          'Sophia',
      };

      // Merge tags into metrics for list endpoints
      const nextMetrics = {
        ...metrics,
        tags,
        callSummary: insight.summary,
        sentiment: insight.sentiment,
        primaryIntent: insight.primaryIntent,
        hubIngestedAt: new Date().toISOString(),
      };

      const row = await db.conversationInsight.upsert({
        where: { voiceCallId: call.id },
        create: {
          dealershipId: call.dealershipId,
          voiceCallId: call.id,
          summaryEncrypted: encryptSensitiveText(insight.summary),
          keyPointsJson: JSON.stringify(insight.keyPoints),
          sentiment: insight.sentiment,
          primaryIntent: insight.primaryIntent,
          suggestedAppointmentJson: JSON.stringify(suggested),
          outcome: insight.outcome || call.outcome,
          promptVersion: insight.promptVersion,
        },
        update: {
          summaryEncrypted: encryptSensitiveText(insight.summary),
          keyPointsJson: JSON.stringify(insight.keyPoints),
          sentiment: insight.sentiment,
          primaryIntent: insight.primaryIntent,
          suggestedAppointmentJson: JSON.stringify(suggested),
          outcome: insight.outcome || call.outcome,
          promptVersion: insight.promptVersion,
        },
      });

      await db.voiceCall.update({
        where: { id: call.id },
        data: {
          metricsJson: JSON.stringify(nextMetrics),
          outcome: insight.outcome || call.outcome,
        },
      });

      await writeHubAudit({
        dealershipId: call.dealershipId,
        entityType: 'conversation',
        entityId: call.id,
        action: 'conversation.auto_ingest',
        metadata: {
          insightId: row.id,
          primaryIntent: insight.primaryIntent,
          sentiment: insight.sentiment,
          tags,
          agent: call.conversation?.activeAgent,
        },
      });

      logger.info('hub.call_ingested', {
        callId: call.id,
        dealershipId: call.dealershipId,
        insightId: row.id,
        tagsCount: tags.length,
      });

      return { ok: true, insightId: row.id };
    });
  } catch (error) {
    logger.error('hub.call_ingest_failed', {
      callId: input.callId,
      callSid: input.callSid,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'ingest_failed',
    };
  }
}

/**
 * Fire-and-forget safe wrapper for webhook paths (never throws to Twilio).
 */
export async function ingestCompletedCallToHubSafe(
  input: Parameters<typeof ingestCompletedCallToHub>[0]
): Promise<void> {
  try {
    await ingestCompletedCallToHub(input);
  } catch (error) {
    logger.error('hub.call_ingest_safe_error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
