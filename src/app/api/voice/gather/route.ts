import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  loadCallContext,
  withDealershipVoiceRls,
} from '@/lib/voiceAgent/callLifecycle';
import { resolveDealershipContext } from '@/lib/voiceAgent/dealershipContext';
import { processAgentTurn } from '@/lib/voiceAgent/runtime';
import {
  absoluteVoiceUrl,
  parseTwilioForm,
  twimlDialHuman,
  twimlGather,
  twimlSayHangup,
  validateTwilioSignature,
} from '@/lib/voiceAgent/twilio';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Twilio <Gather> callback: caller speech → Sophia agent turn → TwiML.
 */
export async function POST(request: Request) {
  try {
    const urlObj = new URL(request.url);
    const callId = urlObj.searchParams.get('callId')?.trim() || '';
    const params = await parseTwilioForm(request);
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || '';
    const signature = request.headers.get('x-twilio-signature');
    const signedUrl = absoluteVoiceUrl(
      `/api/voice/gather?callId=${encodeURIComponent(callId)}`,
      request
    );

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

    // Empty result after silence recovery — gentle re-prompt instead of hanging up
    if (!speechResult) {
      const actionUrl = absoluteVoiceUrl(
        `/api/voice/gather?callId=${encodeURIComponent(callId)}`,
        request
      );
      return new NextResponse(
        twimlGather({
          actionUrl,
          say: 'I did not quite catch that. Please tell me how I can help — for example, service, parts, or sales.',
        }),
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    const dealershipContext = resolveDealershipContext({
      dealershipId: ctx.dealershipId,
      dealershipName: ctx.dealershipName,
      toE164: ctx.toE164,
    });

    const turn = await withDealershipVoiceRls(ctx.dealershipId, async () =>
      processAgentTurn({
        dealershipId: ctx.dealershipId,
        dealershipName: ctx.dealershipName,
        callId,
        callerUtterance: speechResult,
        activeAgent: ctx.activeAgent,
        state: ctx.state,
        toE164: ctx.toE164,
        dealershipContext,
      })
    );

    if (turn.dialHumanE164) {
      return new NextResponse(
        twimlDialHuman({
          say: turn.speech,
          dialE164: turn.dialHumanE164,
        }),
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (turn.endCall) {
      return new NextResponse(twimlSayHangup(turn.speech), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const actionUrl = absoluteVoiceUrl(
      `/api/voice/gather?callId=${encodeURIComponent(callId)}`,
      request
    );
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
        'I am having a brief technical issue. Please try calling again, or visit the dealership and we will take excellent care of you. Goodbye.'
      ),
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}
