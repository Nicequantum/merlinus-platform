import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { markCallCompleted } from '@/lib/voiceAgent/callLifecycle';
import {
  absoluteVoiceUrl,
  parseTwilioForm,
  validateTwilioSignature,
} from '@/lib/voiceAgent/twilio';

export const runtime = 'nodejs';

/**
 * PR-M5a — Twilio status callback (optional). Marks call completed.
 */
export async function POST(request: Request) {
  try {
    const params = await parseTwilioForm(request);
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || '';
    const signature = request.headers.get('x-twilio-signature');
    const url = absoluteVoiceUrl('/api/voice/status');

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

    const callSid = params.CallSid?.trim();
    const status = params.CallStatus?.trim() || 'completed';
    const duration = Number(params.CallDuration);
    await markCallCompleted({
      callSid,
      status: ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(status)
        ? status
        : 'completed',
      durationSec: Number.isFinite(duration) ? duration : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('voice.status.error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
