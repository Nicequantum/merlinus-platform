import { getRlsDb, withSessionRls } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import {
  createAiJob,
  markAiJobFailed,
  markAiJobRunning,
  markAiJobSucceeded,
  scheduleBackgroundWork,
} from '@/lib/aiJobs';
import { decryptSensitiveText, encryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { writeHubAudit } from '@/lib/hub/audit';
import { generateConversationInsight } from '@/lib/hub/insightAi';
import { parseJsonArray, parseJsonObject } from '@/lib/hub/mappers';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { categorizeCall } from '@/lib/voiceAgent/registry';
import { parseConversationState } from '@/lib/voiceAgent/runtime';
import { parseRouteParams } from '@/lib/validation';
import type { SessionPayload } from '@/lib/auth';
import { z } from 'zod';

const paramsSchema = z.object({ callId: z.string().trim().min(1).max(64) });

export const maxDuration = 60;

async function runSummarizeWork(
  session: SessionPayload,
  callId: string
): Promise<Record<string, unknown>> {
  const call = await getRlsDb().voiceCall.findFirst({
    where: { id: callId, dealershipId: session.dealershipId },
    include: {
      conversation: true,
      segments: { orderBy: { createdAt: 'asc' }, take: 200 },
    },
  });
  if (!call) {
    throw Object.assign(new Error(NOT_FOUND_ERROR), { status: 404 });
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
  const routingPath = state.routingPath || [];

  const insight = await generateConversationInsight({
    dealershipName: session.dealershipName || 'Dealership',
    transcript,
    metrics,
    slots,
  });

  const tags = categorizeCall({
    primaryIntent: insight.primaryIntent,
    routingPath,
    outcome: insight.outcome || call.outcome,
    slots,
  });
  const suggested = {
    ...(insight.suggestedAppointment || {}),
    customerName: slots.customerName,
    customerPhone: slots.customerPhone,
    vehicleLabel: slots.vehicleLabel,
    vin: slots.vin,
    voiceCallId: call.id,
    tags,
  };

  const row = await getRlsDb().conversationInsight.upsert({
    where: { voiceCallId: call.id },
    create: {
      dealershipId: session.dealershipId,
      voiceCallId: call.id,
      summaryEncrypted: encryptSensitiveText(insight.summary),
      keyPointsJson: JSON.stringify(insight.keyPoints),
      sentiment: insight.sentiment,
      primaryIntent: insight.primaryIntent,
      suggestedAppointmentJson: JSON.stringify(suggested),
      outcome: insight.outcome,
      promptVersion: insight.promptVersion,
    },
    update: {
      summaryEncrypted: encryptSensitiveText(insight.summary),
      keyPointsJson: JSON.stringify(insight.keyPoints),
      sentiment: insight.sentiment,
      primaryIntent: insight.primaryIntent,
      suggestedAppointmentJson: JSON.stringify(suggested),
      outcome: insight.outcome,
      promptVersion: insight.promptVersion,
    },
  });

  await getRlsDb().voiceCall.update({
    where: { id: call.id },
    data: {
      metricsJson: JSON.stringify({
        ...metrics,
        tags,
        callSummary: insight.summary,
        sentiment: insight.sentiment,
        primaryIntent: insight.primaryIntent,
        hubIngestedAt: new Date().toISOString(),
      }),
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
}

/**
 * AI summarize a voice call for the Hub.
 * P1-1: body `{ "async": true }` returns `{ jobId, status }` immediately; poll GET /api/ai-jobs/:id.
 * Default remains synchronous for backward compatibility.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ callId: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  let wantAsync = false;
  try {
    const body = (await request.clone().json().catch(() => null)) as { async?: unknown } | null;
    wantAsync = body?.async === true || body?.async === '1' || body?.async === 1;
  } catch {
    wantAsync = false;
  }

  return withAuth(
    request,
    async (session) => {
      const callId = routeParams.data.callId;

      if (!wantAsync) {
        try {
          return await runSummarizeWork(session, callId);
        } catch (error) {
          if (error instanceof Error && (error as { status?: number }).status === 404) {
            return apiError(NOT_FOUND_ERROR, 404);
          }
          throw error;
        }
      }

      // Async path: create job, schedule work, return immediately
      const exists = await getRlsDb().voiceCall.findFirst({
        where: { id: callId, dealershipId: session.dealershipId },
        select: { id: true },
      });
      if (!exists) return apiError(NOT_FOUND_ERROR, 404);

      const job = await createAiJob({
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        kind: 'hub.summarize',
        entityType: 'voiceCall',
        entityId: callId,
      });

      // Snapshot session fields for background (avoid closed request state)
      const sessionSnap: SessionPayload = { ...session };

      await scheduleBackgroundWork(`hub.summarize:${job.id}`, async () => {
        try {
          await withSessionRls(sessionSnap, async () => {
            await markAiJobRunning(job.id);
            const result = await runSummarizeWork(sessionSnap, callId);
            await markAiJobSucceeded(job.id, result);
          });
        } catch (error) {
          logger.warn('hub.summarize.async_failed', {
            jobId: job.id,
            callId,
            error: error instanceof Error ? error.message : String(error),
          });
          try {
            await withSessionRls(sessionSnap, async () => {
              await markAiJobFailed(
                job.id,
                error instanceof Error ? error.message : 'Summarize failed'
              );
            });
          } catch {
            // best-effort
          }
        }
      });

      return {
        async: true,
        jobId: job.id,
        status: 'queued' as const,
        pollUrl: `/api/ai-jobs/${job.id}`,
        message: 'Summarization started. Poll pollUrl until status is succeeded or failed.',
      };
    },
    {
      rateLimitKey: 'hub.conversation.summarize',
      rateLimit: RATE_LIMITS.generate,
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'calendar_hub',
      trackUsage: true,
      blockInMaintenance: true,
    }
  );
}
