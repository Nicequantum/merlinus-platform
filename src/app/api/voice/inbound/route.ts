import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  ensureVoiceModuleEnabled,
  getOrCreateInboundCall,
  resolveVoiceLineByToNumber,
  withDealershipVoiceRls,
} from '@/lib/voiceAgent/callLifecycle';
import { appendTranscriptSegment, buildOpeningGreeting } from '@/lib/voiceAgent/runtime';
import {
  absoluteVoiceUrl,
  parseTwilioForm,
  twimlGather,
  twimlReject,
  validateTwilioSignature,
} from '@/lib/voiceAgent/twilio';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * PR-M5a — Twilio voice webhook: inbound call start.
 * Configure the Twilio number Voice URL to POST here.
 */
export async function POST(request: Request) {
  try {
    const params = await parseTwilioForm(request);
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || '';
    const signature = request.headers.get('x-twilio-signature');
    const url = absoluteVoiceUrl('/api/voice/inbound');

    if (
      !validateTwilioSignature({
        authToken,
        signature,
        url,
        params,
      })
    ) {
      logger.warn('voice.inbound.bad_signature');
      return new NextResponse(twimlReject('We could not verify this call.'), {
        status: 403,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const callSid = params.CallSid?.trim() || '';
    const from = params.From?.trim() || '';
    const to = params.To?.trim() || '';
    if (!callSid || !to) {
      return new NextResponse(twimlReject(), {
        status: 400,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const line = await resolveVoiceLineByToNumber(to);
    if (!line) {
      logger.warn('voice.inbound.unknown_number', { to });
      return new NextResponse(
        twimlReject('This number is not configured for the dealership voice agent.'),
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    const moduleOn = await ensureVoiceModuleEnabled(line.dealershipId);
    if (!moduleOn) {
      return new NextResponse(
        twimlReject('The voice agent is not enabled for this dealership.'),
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    const call = await getOrCreateInboundCall({
      line,
      callSid,
      from,
      to,
    });

    const greeting = await buildOpeningGreeting(line.dealershipName);
    if (call.isNew) {
      await withDealershipVoiceRls(line.dealershipId, async () => {
        await appendTranscriptSegment({
          callId: call.callId,
          speaker: 'agent',
          text: greeting,
          agentName: 'receptionist',
        });
      });
    }

    const actionUrl = absoluteVoiceUrl(`/api/voice/gather?callId=${encodeURIComponent(call.callId)}`);
    const xml = twimlGather({ actionUrl, say: greeting });
    return new NextResponse(xml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    logger.error('voice.inbound.error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return new NextResponse(
      twimlReject('We are unable to take your call right now. Please try again later.'),
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}
