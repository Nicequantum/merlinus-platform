/**
 * Durable queue handler — hub conversation summarize (optional jobType).
 */
import 'server-only';

import type { AiQueueMessage } from '@/lib/queue/types';
import { markAiJobProgress } from '@/lib/aiJobs/service';

export async function handleHubSummarizeJob(
  msg: AiQueueMessage
): Promise<Record<string, unknown>> {
  const callId =
    (typeof msg.payload.callId === 'string' && msg.payload.callId) ||
    (typeof msg.payload.entityId === 'string' && msg.payload.entityId) ||
    '';
  if (!callId) {
    throw new Error('hub.summarize requires payload.callId');
  }

  await markAiJobProgress(msg.jobId, 30);

  // Existing hub summarize route remains the primary path; this handler is a durable alias.
  // Import runtime insight generator when present.
  try {
    const { generateConversationInsight } = await import('@/lib/hub/insightAi');
    const { getRlsDb, withRlsBypass } = await import('@/lib/apex/rlsContext');
    const { decryptSensitiveText } = await import('@/lib/encryption');

    const call = await withRlsBypass(async () =>
      getRlsDb().voiceCall.findFirst({
        where: { id: callId, dealershipId: msg.dealershipId },
        include: { conversation: true, segments: { take: 100, orderBy: { createdAt: 'asc' } } },
      })
    );
    if (!call) throw new Error('Voice call not found');

    let transcript = decryptSensitiveText(call.transcriptEncrypted || '');
    if (!transcript && call.segments?.length) {
      transcript = call.segments
        .map((s) => decryptSensitiveText(s.textEncrypted || ''))
        .join('\n');
    }

    await markAiJobProgress(msg.jobId, 60);
    const insight = await generateConversationInsight({
      dealershipName: 'Dealership',
      transcript,
      metrics: {},
      slots: {},
    });
    await markAiJobProgress(msg.jobId, 90);
    return { callId, insight };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
