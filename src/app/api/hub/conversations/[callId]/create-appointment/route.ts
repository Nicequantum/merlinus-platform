import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { decryptSensitiveText, encryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { writeHubAudit } from '@/lib/hub/audit';
import { mapAppointmentDto, parseJsonObject } from '@/lib/hub/mappers';
import { phoneLast4 } from '@/lib/department/piiHelpers';
import { parseConversationState } from '@/lib/voiceAgent/runtime';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ callId: z.string().trim().min(1).max(64) });

/**
 * One-click: create a ServiceAppointment from AI call insight + slots.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    _request,
    async (session) => {
      const call = await getRlsDb().voiceCall.findFirst({
        where: { id: routeParams.data.callId, dealershipId: session.dealershipId },
        include: { conversation: true },
      });
      if (!call) return apiError(NOT_FOUND_ERROR, 404);

      const insight = await getRlsDb().conversationInsight.findUnique({
        where: { voiceCallId: call.id },
      });
      const suggested = insight
        ? parseJsonObject(insight.suggestedAppointmentJson)
        : {};
      const state = parseConversationState(call.conversation?.stateJson);
      const slots = state.slots || {};

      const title =
        (typeof suggested.title === 'string' && suggested.title.trim()) ||
        (slots.subject ? String(slots.subject) : null) ||
        (insight?.primaryIntent
          ? `Follow-up: ${insight.primaryIntent.replace(/_/g, ' ')}`
          : 'Service follow-up from phone call');

      const categoryRaw =
        (typeof suggested.category === 'string' && suggested.category) || 'service';
      const category = ['service', 'sales', 'parts', 'loaner', 'other'].includes(categoryRaw)
        ? categoryRaw
        : 'service';

      const customerName =
        (typeof suggested.customerName === 'string' && suggested.customerName) ||
        slots.customerName ||
        '';
      const customerPhone =
        (typeof suggested.customerPhone === 'string' && suggested.customerPhone) ||
        slots.customerPhone ||
        '';
      const vehicleLabel =
        (typeof suggested.vehicleLabel === 'string' && suggested.vehicleLabel) ||
        slots.vehicleLabel ||
        null;

      const notesParts = [
        typeof suggested.notes === 'string' ? suggested.notes : '',
        typeof suggested.preferredWindow === 'string'
          ? `Preferred window: ${suggested.preferredWindow}`
          : '',
        insight ? decryptSensitiveText(insight.summaryEncrypted || '') : '',
        `Source call ${call.id}`,
      ].filter(Boolean);

      // Default start: tomorrow 9:00 local-ish (UTC+offset not critical for seed)
      const startsAt = new Date();
      startsAt.setUTCDate(startsAt.getUTCDate() + 1);
      startsAt.setUTCHours(14, 0, 0, 0); // ~9–10am US ET-ish

      const row = await getRlsDb().serviceAppointment.create({
        data: {
          dealershipId: session.dealershipId,
          title: String(title).slice(0, 200),
          category,
          status: 'scheduled',
          startsAt,
          customerNameEncrypted: encryptSensitiveText(String(customerName)),
          customerPhoneEncrypted: encryptSensitiveText(String(customerPhone)),
          customerPhoneLast4: phoneLast4(String(customerPhone)),
          vehicleLabel: vehicleLabel ? String(vehicleLabel).slice(0, 120) : null,
          notesEncrypted: encryptSensitiveText(notesParts.join('\n\n').slice(0, 4000)),
          source: 'voice_suggestion',
          voiceCallId: call.id,
          createdByTechnicianId: session.technicianId,
        },
      });

      await writeHubAudit({
        dealershipId: session.dealershipId,
        entityType: 'appointment',
        entityId: row.id,
        action: 'appointment.create_from_call',
        technicianId: session.technicianId,
        metadata: { voiceCallId: call.id, title: row.title },
      });

      return { appointment: mapAppointmentDto(row) };
    },
    {
      rateLimitKey: 'hub.conversation.create_appointment',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
