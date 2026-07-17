import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { withRlsBypass } from '@/lib/apex/rlsContext';
import { storeTwilioRecording } from '@/lib/voiceAgent/recording';
import {
  absoluteVoiceUrl,
  parseTwilioForm,
  validateTwilioSignature,
} from '@/lib/voiceAgent/twilio';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * PR-M5b — Twilio recording status callback.
 * Configure RecordingStatusCallback on the number or TwiML if desired.
 */
export async function POST(request: Request) {
  try {
    const params = await parseTwilioForm(request);
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || '';
    const signature = request.headers.get('x-twilio-signature');
    const url = absoluteVoiceUrl('/api/voice/recording');

    if (
      !validateTwilioSignature({
        authToken,
        signature,
        url,
        params,
      })
    ) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const callSid = params.CallSid?.trim() || '';
    const recordingSid = params.RecordingSid?.trim() || '';
    const recordingUrl = params.RecordingUrl?.trim() || '';
    const recordingStatus = params.RecordingStatus?.trim() || '';

    if (!callSid || !recordingSid || !recordingUrl) {
      return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
    }

    if (recordingStatus && recordingStatus !== 'completed') {
      await withRlsBypass(async (tx) => {
        await tx.voiceCall.updateMany({
          where: { externalCallId: callSid },
          data: {
            recordingSid,
            recordingUrl,
            recordingStatus: recordingStatus || 'queued',
          },
        });
      });
      return NextResponse.json({ ok: true, deferred: true });
    }

    const call = await withRlsBypass(async (tx) =>
      tx.voiceCall.findUnique({ where: { externalCallId: callSid } })
    );
    if (!call) {
      return NextResponse.json({ ok: false, error: 'call not found' }, { status: 404 });
    }

    await withRlsBypass(async (tx) => {
      await tx.voiceCall.update({
        where: { id: call.id },
        data: {
          recordingSid,
          recordingUrl,
          recordingStatus: 'queued',
        },
      });
    });

    const stored = await storeTwilioRecording({
      dealershipId: call.dealershipId,
      callId: call.id,
      recordingSid,
      recordingUrl,
    });

    if (!stored) {
      await withRlsBypass(async (tx) => {
        await tx.voiceCall.update({
          where: { id: call.id },
          data: { recordingStatus: 'failed' },
        });
      });
    }

    return NextResponse.json({ ok: true, stored: Boolean(stored) });
  } catch (error) {
    logger.error('voice.recording.error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
