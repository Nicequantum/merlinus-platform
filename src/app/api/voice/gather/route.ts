import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  loadCallContext,
  withDealershipVoiceRls,
} from '@/lib/voiceAgent/callLifecycle';
import { processAgentTurn } from '@/lib/voiceAgent/runtime';
import {
  absoluteVoiceUrl,
  parseTwilioForm,
  twimlGather,
  twimlSayHangup,
  validateTwilioSignature,
} from '@/lib/voiceAgent/twilio';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * PR-M5a — Twilio <Gather> callback: caller speech → agent turn → TwiML.
 */
export async function POST(request: Request) {
  try {
    const urlObj = new URL(request.url);
    const callId = urlObj.searchParams.get('callId')?.trim() || '';
    const params = await parseTwilioForm(request);
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || '';
    const signature = request.headers.get('x-twilio-signature');
    // Twilio signs the full URL including query string as configured
    const signedUrl = absoluteVoiceUrl(`/api/voice/gather?callId=${encodeURIComponent(callId)}`);

    if (
      !validateTwilioSignature({
        authToken,
        signature,
        url: signedUrl,
        params,
      })
    ) {
      logger.warn('voice.gather.bad_signature');
      return new NextResponse(twimlSayHangup('Goodbye.'), {
        status: 403,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    if (!callId) {
      return new NextResponse(twimlSayHangup('Goodbye.'), {
        status: 400,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const ctx = await loadCallContext(callId);
    if (!ctx) {
      return new NextResponse(twimlSayHangup('This call session is no longer active. Goodbye.'), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const speechResult =
      params.SpeechResult?.trim() ||
      params.UnstableSpeechResult?.trim() ||
      '';

    const turn = await withDealershipVoiceRls(ctx.dealershipId, async () =>
      processAgentTurn({
        dealershipId: ctx.dealershipId,
        dealershipName: ctx.dealershipName,
        callId,
        callerUtterance: speechResult || '(silence)',
        activeAgent: ctx.activeAgent,
        state: ctx.state,
      })
    );

    if (turn.endCall) {
      return new NextResponse(twimlSayHangup(turn.speech), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const actionUrl = absoluteVoiceUrl(`/api/voice/gather?callId=${encodeURIComponent(callId)}`);
    return new NextResponse(twimlGather({ actionUrl, say: turn.speech }), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    logger.error('voice.gather.error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return new NextResponse(
      twimlSayHangup(
        'I am having trouble processing that. Please try calling again or visit the dealership. Goodbye.'
      ),
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}
