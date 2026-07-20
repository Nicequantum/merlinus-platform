/**
 * Twilio webhook helpers (signature + TwiML) — Sophia voice path.
 */

import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import { phoneLast4 } from '@/lib/department/piiHelpers';

/** Premium neural voice for luxury brand tone */
const DEFAULT_SAY_VOICE = process.env.VOICE_TWILIO_SAY_VOICE?.trim() || 'Polly.Joanna-Neural';

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

function sayTag(text: string): string {
  return `<Say voice="${escapeXml(DEFAULT_SAY_VOICE)}">${escapeXml(text)}</Say>`;
}

/**
 * Speech gather with enhanced prompts, silence recovery, and professional voice.
 */
export function twimlGather(input: {
  actionUrl: string;
  say: string;
  language?: string;
  hints?: string;
  /** Optional second chance prompt when silence */
  silencePrompt?: string;
}): string {
  const lang = input.language || 'en-US';
  const hints =
    input.hints ||
    'service, parts, sales, appointment, hours, loaner, warranty, roadside, directions';
  const silence =
    input.silencePrompt ||
    'I am still here whenever you are ready. How may I help you today?';
  const action = escapeXml(input.actionUrl);

  // Nested Gather: first attempt, then one recovery gather, then graceful close
  return twimlResponse(
    [
      `<Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="${escapeXml(lang)}" timeout="6" hints="${escapeXml(hints)}" actionOnEmptyResult="true">`,
      sayTag(input.say),
      `</Gather>`,
      `<Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="${escapeXml(lang)}" timeout="5" hints="${escapeXml(hints)}" actionOnEmptyResult="true">`,
      sayTag(silence),
      `</Gather>`,
      sayTag(
        'I am having trouble hearing you. Please call again when you can, or visit us at the dealership. Goodbye.'
      ),
      `<Hangup/>`,
    ].join('')
  );
}

export function twimlSayHangup(say: string): string {
  return twimlResponse(`${sayTag(say)}<Hangup/>`);
}

/** Warm transfer to a live team member after a short courtesy message. */
export function twimlDialHuman(input: {
  say: string;
  dialE164: string;
  callerId?: string;
}): string {
  const dialAttrs = input.callerId
    ? ` callerId="${escapeXml(input.callerId)}"`
    : '';
  return twimlResponse(
    [
      sayTag(input.say),
      `<Dial${dialAttrs} timeout="25">${escapeXml(input.dialE164)}</Dial>`,
      sayTag(
        'I am sorry — no one is available to take your call right now. We will have a team member follow up. Goodbye.'
      ),
      `<Hangup/>`,
    ].join('')
  );
}

export function twimlReject(message?: string): string {
  if (message) {
    return twimlResponse(`${sayTag(message)}<Reject/>`);
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
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.MERLIN_PRODUCTION === 'true' ||
    process.env.APEX_ENV === 'production';
  if (skipRequested && !isProduction) return true;
  if (!input.signature || !input.authToken) return false;

  const data =
    input.url +
    Object.keys(input.params)
      .sort()
      .map((k) => k + input.params[k])
      .join('');

  const expected = createHmac('sha1', input.authToken)
    .update(Buffer.from(data, 'utf8'))
    .digest('base64');
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

/**
 * Public absolute URL for Twilio webhooks.
 * Prefer production hosts; fall back to request Host when provided.
 */
export function absoluteVoiceUrl(path: string, request?: Request | null): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.MERLIN_BASE_URL,
    process.env.APP_URL,
    process.env.VOICE_PUBLIC_BASE_URL,
  ];
  for (const raw of candidates) {
    const v = raw?.trim();
    if (!v) continue;
    try {
      const u = new URL(v.includes('://') ? v : `https://${v}`);
      const host = u.host.toLowerCase();
      if (
        host === 'localhost' ||
        host.startsWith('localhost:') ||
        host.startsWith('127.0.0.1')
      ) {
        continue;
      }
      return `${u.protocol}//${u.host}${path.startsWith('/') ? path : `/${path}`}`;
    } catch {
      // next
    }
  }

  if (request) {
    const host =
      request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
      request.headers.get('host')?.trim() ||
      '';
    if (host && !host.toLowerCase().includes('localhost')) {
      const proto =
        request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'http'
          ? 'http'
          : 'https';
      return `${proto}://${host}${path.startsWith('/') ? path : `/${path}`}`;
    }
  }

  if (process.env.VERCEL_URL?.trim()) {
    return `https://${process.env.VERCEL_URL.trim()}${path.startsWith('/') ? path : `/${path}`}`;
  }

  return `http://localhost:3000${path.startsWith('/') ? path : `/${path}`}`;
}
