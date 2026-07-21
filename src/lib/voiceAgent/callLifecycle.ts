/**
 * PR-M5a — create/load calls under dealership RLS context.
 */

import 'server-only';

import { encryptSensitiveText } from '@/lib/encryption';
import { withRlsBypass, withRlsContext } from '@/lib/apex/rlsContext';
import { isModuleEnabled } from '@/lib/modules/entitlements';
import { fromLast4FromPhone, normalizeToE164 } from '@/lib/voiceAgent/twilio';
import { normalizeAgentName, parseConversationState } from '@/lib/voiceAgent/runtime';
import type { ConversationState, VoiceAgentName } from '@/lib/voiceAgent/types';
import { emptyConversationState } from '@/lib/voiceAgent/types';

export type BoundLine = {
  lineId: string;
  dealershipId: string;
  dealershipName: string;
  e164Number: string;
};

/** Resolve inbound DID → rooftop (bypass for global number lookup). */
export async function resolveVoiceLineByToNumber(toRaw: string): Promise<BoundLine | null> {
  const to = normalizeToE164(toRaw);
  return withRlsBypass(async (tx) => {
    const line = await tx.voiceAgentLine.findFirst({
      where: {
        isActive: true,
        OR: [{ e164Number: to }, { e164Number: toRaw.trim() }],
      },
      include: { dealership: { select: { id: true, name: true } } },
    });
    if (!line) return null;
    return {
      lineId: line.id,
      dealershipId: line.dealershipId,
      dealershipName: line.dealership.name,
      e164Number: line.e164Number,
    };
  });
}

export async function ensureVoiceModuleEnabled(dealershipId: string): Promise<boolean> {
  return withRlsBypass(async () => isModuleEnabled(dealershipId, 'voice_agent'));
}

export async function withDealershipVoiceRls<T>(
  dealershipId: string,
  fn: () => Promise<T>
): Promise<T> {
  return withRlsContext(
    {
      technicianId: 'voice-agent',
      activeDealershipId: dealershipId,
      dealerId: null,
      scopeMode: 'dealership',
      enforced: true,
      softOpen: false,
    },
    fn
  );
}

export async function getOrCreateInboundCall(input: {
  line: BoundLine;
  callSid: string;
  from: string;
  to: string;
}): Promise<{
  callId: string;
  conversationId: string;
  activeAgent: VoiceAgentName;
  state: ConversationState;
  isNew: boolean;
}> {
  return withDealershipVoiceRls(input.line.dealershipId, async () => {
    const { getRlsDb } = await import('@/lib/apex/rlsContext');
    const db = getRlsDb();
    const existing = await db.voiceCall.findUnique({
      where: { externalCallId: input.callSid },
      include: { conversation: true },
    });
    if (existing?.conversation) {
      return {
        callId: existing.id,
        conversationId: existing.conversation.id,
        activeAgent: normalizeAgentName(existing.conversation.activeAgent),
        state: parseConversationState(existing.conversation.stateJson),
        isNew: false,
      };
    }

    const fromNorm = normalizeToE164(input.from);
    const initialState = emptyConversationState();
    initialState.slots.customerPhone = fromNorm;

    const call = await db.voiceCall.create({
      data: {
        dealershipId: input.line.dealershipId,
        lineId: input.line.lineId,
        externalCallId: input.callSid,
        direction: 'inbound',
        fromEncrypted: encryptSensitiveText(fromNorm),
        fromLast4: fromLast4FromPhone(fromNorm),
        toE164: normalizeToE164(input.to),
        status: 'in_progress',
        startedAt: new Date(),
        routingPathJson: JSON.stringify(['receptionist']),
        metricsJson: JSON.stringify(initialState.metrics),
        recordingStatus: 'none',
        conversation: {
          create: {
            dealershipId: input.line.dealershipId,
            activeAgent: 'receptionist',
            stateJson: JSON.stringify(initialState),
          },
        },
      },
      include: { conversation: true },
    });

    return {
      callId: call.id,
      conversationId: call.conversation!.id,
      activeAgent: 'receptionist' as VoiceAgentName,
      state: parseConversationState(call.conversation!.stateJson),
      isNew: true,
    };
  });
}

export async function loadCallContext(callId: string): Promise<{
  dealershipId: string;
  dealershipName: string;
  activeAgent: VoiceAgentName;
  state: ConversationState;
  status: string;
  toE164: string;
  fromLast4: string;
} | null> {
  return withRlsBypass(async (tx) => {
    const call = await tx.voiceCall.findUnique({
      where: { id: callId },
      include: {
        conversation: true,
        dealership: { select: { name: true } },
      },
    });
    if (!call?.conversation) return null;
    return {
      dealershipId: call.dealershipId,
      dealershipName: call.dealership.name,
      activeAgent: normalizeAgentName(call.conversation.activeAgent),
      state: parseConversationState(call.conversation.stateJson),
      status: call.status,
      toE164: call.toE164 || '',
      fromLast4: call.fromLast4 || '',
    };
  });
}

export async function markCallCompleted(input: {
  callSid?: string;
  callId?: string;
  durationSec?: number;
  status?: string;
  /** When false, skip hub AI ingest (default: ingest completed/success paths) */
  ingestToHub?: boolean;
}): Promise<void> {
  let resolvedCallId: string | undefined = input.callId;

  await withRlsBypass(async (tx) => {
    const where = input.callId
      ? { id: input.callId }
      : input.callSid
        ? { externalCallId: input.callSid }
        : null;
    if (!where) return;

    if (!resolvedCallId && input.callSid) {
      const row = await tx.voiceCall.findUnique({
        where: { externalCallId: input.callSid },
        select: { id: true },
      });
      resolvedCallId = row?.id;
    }

    await tx.voiceCall.updateMany({
      where,
      data: {
        status: input.status || 'completed',
        endedAt: new Date(),
        ...(typeof input.durationSec === 'number' ? { durationSec: input.durationSec } : {}),
      },
    });
  });

  const status = input.status || 'completed';
  const shouldIngest = input.ingestToHub !== false && status === 'completed';

  if (shouldIngest && (resolvedCallId || input.callSid)) {
    // Dynamic import avoids circular deps with hub → runtime
    const { ingestCompletedCallToHubSafe } = await import('@/lib/hub/callIngest');
    await ingestCompletedCallToHubSafe({
      callId: resolvedCallId,
      callSid: input.callSid,
      skipIfExists: true,
    });
  }
}
