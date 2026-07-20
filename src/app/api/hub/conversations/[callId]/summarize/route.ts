import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { decryptSensitiveText, encryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { writeHubAudit } from '@/lib/hub/audit';
import { generateConversationInsight } from '@/lib/hub/insightAi';
import { parseJsonArray, parseJsonObject } from '@/lib/hub/mappers';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ callId: z.string().trim().min(1).max(64) });

export const maxDuration = 60;

/**
 * AI summarize a voice call for the Hub (key points, sentiment, appointment suggestion).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ callId: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const call = await getRlsDb().voiceCall.findFirst({
        where: { id: routeParams.data.callId, dealershipId: session.dealershipId },
        include: {
          conversation: true,
          segments: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
      });
      if (!call) return apiError(NOT_FOUND_ERROR, 404);

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
      let slots: Record<string, unknown> = {};
      try {
        const state = JSON.parse(call.conversation?.stateJson || '{}') as {
          slots?: Record<string, unknown>;
        };
        slots = state.slots || {};
      } catch {
        slots = {};
      }

      const insight = await generateConversationInsight({
        dealershipName: session.dealershipName || 'Dealership',
        transcript,
        metrics,
        slots,
      });

      const row = await getRlsDb().conversationInsight.upsert({
        where: { voiceCallId: call.id },
        create: {
          dealershipId: session.dealershipId,
          voiceCallId: call.id,
          summaryEncrypted: encryptSensitiveText(insight.summary),
          keyPointsJson: JSON.stringify(insight.keyPoints),
          sentiment: insight.sentiment,
          primaryIntent: insight.primaryIntent,
          suggestedAppointmentJson: JSON.stringify(insight.suggestedAppointment || {}),
          outcome: insight.outcome,
          promptVersion: insight.promptVersion,
        },
        update: {
          summaryEncrypted: encryptSensitiveText(insight.summary),
          keyPointsJson: JSON.stringify(insight.keyPoints),
          sentiment: insight.sentiment,
          primaryIntent: insight.primaryIntent,
          suggestedAppointmentJson: JSON.stringify(insight.suggestedAppointment || {}),
          outcome: insight.outcome,
          promptVersion: insight.promptVersion,
        },
      });

      await writeHubAudit({
        dealershipId: session.dealershipId,
        entityType: 'conversation',
        entityId: call.id,
        action: 'conversation.summarize',
        technicianId: session.technicianId,
        metadata: {
          sentiment: insight.sentiment,
          primaryIntent: insight.primaryIntent,
          promptVersion: insight.promptVersion,
        },
      });

      return {
        insight: {
          id: row.id,
          voiceCallId: call.id,
          summary: insight.summary,
          keyPoints: parseJsonArray(row.keyPointsJson),
          sentiment: row.sentiment,
          primaryIntent: row.primaryIntent,
          suggestedAppointment: parseJsonObject(row.suggestedAppointmentJson),
          outcome: row.outcome,
          promptVersion: row.promptVersion,
          createdAt: row.createdAt.toISOString(),
        },
      };
    },
    {
      rateLimitKey: 'hub.conversation.summarize',
      rateLimit: RATE_LIMITS.generate,
      requireManager: true,
      requireDealershipContext: true,
      trackUsage: true,
      blockInMaintenance: true,
    }
  );
}
