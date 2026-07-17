import { decryptSensitiveText } from '@/lib/encryption';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { parseConversationState } from '@/lib/voiceAgent/runtime';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

/**
 * PR-M5b — manager call detail: transcript segments, metrics, recording meta.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const call = await getRlsDb().voiceCall.findFirst({
        where: { id: routeParams.data.id, dealershipId: session.dealershipId },
        include: {
          conversation: true,
          line: { select: { label: true, e164Number: true } },
          segments: { orderBy: { createdAt: 'asc' }, take: 300 },
        },
      });
      if (!call) return apiError(NOT_FOUND_ERROR, 404);

      const state = parseConversationState(call.conversation?.stateJson);
      let metrics: unknown = {};
      try {
        metrics = JSON.parse(call.metricsJson || '{}');
      } catch {
        metrics = {};
      }

      return {
        call: {
          id: call.id,
          externalCallId: call.externalCallId,
          status: call.status,
          fromLast4: call.fromLast4,
          toE164: call.toE164,
          direction: call.direction,
          durationSec: call.durationSec,
          startedAt: call.startedAt?.toISOString() ?? null,
          endedAt: call.endedAt?.toISOString() ?? null,
          routingPath: safeJsonArray(call.routingPathJson),
          activeAgent: call.conversation?.activeAgent ?? null,
          lineLabel: call.line?.label ?? null,
          lineNumber: call.line?.e164Number ?? null,
          recordingStatus: call.recordingStatus,
          recordingPathname: call.recordingPathname,
          recordingSid: call.recordingSid,
          hasRecording: Boolean(call.recordingPathname),
          contained: call.contained,
          outcome: call.outcome,
          metrics,
          slots: state.slots,
          handoffs: state.handoffs || [],
          fullTranscript: call.transcriptEncrypted
            ? decryptSensitiveText(call.transcriptEncrypted)
            : null,
          segments: call.segments.map((s) => ({
            id: s.id,
            speaker: s.speaker,
            agentName: s.agentName,
            text: decryptSensitiveText(s.textEncrypted || ''),
            tsMs: s.tsMs,
            createdAt: s.createdAt.toISOString(),
          })),
          createdAt: call.createdAt.toISOString(),
        },
      };
    },
    {
      rateLimitKey: 'voice.calls.get',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'voice_agent',
    }
  );
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
