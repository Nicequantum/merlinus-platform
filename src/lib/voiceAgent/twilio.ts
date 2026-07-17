/**
 * PR-M5a — Twilio webhook helpers (signature + TwiML).
 */

import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import { phoneLast4 } from '@/lib/department/piiHelpers';

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function twimlResponse(bodyInner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${bodyInner}</Response>`;
}

export function twimlGather(input: {
  actionUrl: string;
  say: string;
  language?: string;
}): string {
  const lang = input.language || 'en-US';
  return twimlResponse(
    `<Gather input="speech" action="${escapeXml(input.actionUrl)}" method="POST" speechTimeout="auto" language="${escapeXml(lang)}" timeout="5"><Say voice="Polly.Joanna">${escapeXml(input.say)}</Say></Gather><Say voice="Polly.Joanna">I did not catch that. Please call again if you still need help. Goodbye.</Say>`
  );
}

export function twimlSayHangup(say: string): string {
  return twimlResponse(
    `<Say voice="Polly.Joanna">${escapeXml(say)}</Say><Hangup/>`
  );
}

export function twimlReject(message?: string): string {
  if (message) {
    return twimlResponse(
      `<Say voice="Polly.Joanna">${escapeXml(message)}</Say><Reject/>`
    );
  }
  return twimlResponse('<Reject/>');
}

/**
 * Validate Twilio request signature (X-Twilio-Signature).
 * Skipped when VOICE_TWILIO_SKIP_SIGNATURE=true (local tunnel dev only).
 * Never skips in production / Vercel production — fail closed.
 */
export function validateTwilioSignature(input: {
  authToken: string;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  const skipRequested = process.env.VOICE_TWILIO_SKIP_SIGNATURE?.trim() === 'true';
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  if (skipRequested && !isProduction) return true;
  if (!input.signature || !input.authToken) return false;

  const data =
    input.url +
    Object.keys(input.params)
      .sort()
      .map((k) => k + input.params[k])
      .join('');

  const expected = createHmac('sha1', input.authToken).update(Buffer.from(data, 'utf8')).digest('base64');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(input.signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function parseTwilioForm(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === 'string') params[key] = value;
  });
  return params;
}

export function normalizeToE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+')) return phone.trim();
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.trim();
}

export function fromLast4FromPhone(phone: string): string {
  return phoneLast4(phone);
}

export function absoluteVoiceUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.MERLIN_BASE_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
