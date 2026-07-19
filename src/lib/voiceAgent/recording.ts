/**
 * PR-M5b — store Twilio call recordings in private R2 object storage.
 */

import 'server-only';

import { logger } from '@/lib/logger';
import { withRlsBypass } from '@/lib/apex/rlsContext';
import { isObjectStorageConfigured, putObject } from '@/lib/storage/objectStorage';

/**
 * Download recording from Twilio (basic auth) and store under private R2 path.
 */
export async function storeTwilioRecording(input: {
  dealershipId: string;
  callId: string;
  recordingSid: string;
  recordingUrl: string;
}): Promise<{ pathname: string } | null> {
  if (!isObjectStorageConfigured()) {
    logger.warn('voice.recording.no_r2_binding');
    return null;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    logger.warn('voice.recording.no_twilio_creds');
    return null;
  }

  // Twilio media URLs often need .mp3 or .wav appended
  const mediaUrl = input.recordingUrl.replace(/\.(json)?$/i, '') + '.mp3';
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    logger.warn('voice.recording.download_failed', { status: res.status });
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) return null;

  const safeDealer = input.dealershipId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  const key = `benz-tech/voice-recording/${safeDealer}/${input.callId}-${input.recordingSid}.mp3`;
  await putObject(key, buf, { contentType: 'audio/mpeg' });

  await withRlsBypass(async (tx) => {
    await tx.voiceCall.update({
      where: { id: input.callId },
      data: {
        recordingSid: input.recordingSid,
        recordingUrl: input.recordingUrl,
        recordingPathname: key,
        recordingStatus: 'stored',
      },
    });
  });

  return { pathname: key };
}
