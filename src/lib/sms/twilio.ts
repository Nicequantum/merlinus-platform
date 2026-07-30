import 'server-only';

/**
 * Outbound SMS for video inspection customer links.
 *
 * Required env (all must be set for real delivery — no fake SMS path):
 * - SMS_ENABLED=true (or 1 / yes)
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - TWILIO_FROM_NUMBER (E.164 Twilio number) **OR** TWILIO_MESSAGING_SERVICE_SID
 *
 * Optional WhatsApp (Twilio WhatsApp sender / sandbox):
 * - TWILIO_WHATSAPP_FROM=whatsapp:+14155238886  (sandbox or approved sender)
 *   When set, sendSms can use channel: 'whatsapp'
 *
 * Disabled unless SMS_ENABLED is explicitly true AND credentials are present.
 */

import { logger } from '@/lib/logger';

export type SmsChannel = 'sms' | 'whatsapp';

function hasTwilioCredentials(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim()
  );
}

function hasSmsFrom(): boolean {
  return Boolean(
    process.env.TWILIO_FROM_NUMBER?.trim() || process.env.TWILIO_MESSAGING_SERVICE_SID?.trim()
  );
}

export function isSmsEnabled(): boolean {
  const flag = process.env.SMS_ENABLED?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  if (flag !== '1' && flag !== 'true' && flag !== 'yes') {
    // Default off unless explicitly enabled
    return false;
  }
  return hasTwilioCredentials() && hasSmsFrom();
}

export function isWhatsAppSmsEnabled(): boolean {
  if (!isSmsEnabled()) return false;
  return Boolean(process.env.TWILIO_WHATSAPP_FROM?.trim());
}

export function normalizeE164(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+') && digits.length >= 11 && digits.length <= 16) return digits;
  const only = phone.replace(/\D/g, '');
  if (only.length === 10) return `+1${only}`;
  if (only.length === 11 && only.startsWith('1')) return `+${only}`;
  if (only.length >= 10 && only.length <= 15) return `+${only}`;
  return null;
}

export async function sendSms(
  to: string,
  body: string,
  options?: { channel?: SmsChannel }
): Promise<{ sid: string; channel: SmsChannel }> {
  if (!isSmsEnabled()) {
    throw new Error(
      'SMS is not configured. Set SMS_ENABLED=true, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER (or TWILIO_MESSAGING_SERVICE_SID).'
    );
  }
  const channel: SmsChannel = options?.channel === 'whatsapp' ? 'whatsapp' : 'sms';
  if (channel === 'whatsapp' && !isWhatsAppSmsEnabled()) {
    throw new Error(
      'WhatsApp is not configured. Set TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886 for sandbox).'
    );
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const params = new URLSearchParams({ Body: body });
  if (channel === 'whatsapp') {
    const waFrom = process.env.TWILIO_WHATSAPP_FROM!.trim();
    const waTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    params.set('From', waFrom.startsWith('whatsapp:') ? waFrom : `whatsapp:${waFrom}`);
    params.set('To', waTo);
  } else {
    params.set('To', to);
    const messagingService = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
    const from = process.env.TWILIO_FROM_NUMBER?.trim();
    // Prefer Messaging Service when set (handles number pools / A2P better).
    if (messagingService) {
      params.set('MessagingServiceSid', messagingService);
    } else if (from) {
      params.set('From', from);
    } else {
      throw new Error('TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID is required.');
    }
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as {
    sid?: string;
    message?: string;
    code?: number | string;
    more_info?: string;
    status?: string;
    error_message?: string;
  };
  if (!res.ok || !data.sid) {
    logger.error('sms.twilio_send_failed', {
      status: res.status,
      channel,
      twilioCode: data.code ?? null,
      twilioMessage: data.message || data.error_message || null,
      moreInfo: data.more_info ?? null,
      toLast4: to.slice(-4),
    });
    const detail = data.message || data.error_message || `SMS send failed (${res.status})`;
    // Friendlier hints for common Twilio trial/A2P rejections
    if (String(data.code) === '21608' || /unverified/i.test(detail)) {
      throw new Error(
        `${detail} — Trial accounts can only text verified numbers. Verify the customer phone in Twilio Console, or upgrade and complete A2P 10DLC.`
      );
    }
    if (String(data.code) === '21211' || /invalid.*phone/i.test(detail)) {
      throw new Error(`${detail} — Use a full mobile number (US 10-digit or +E.164).`);
    }
    throw new Error(detail);
  }
  return { sid: data.sid, channel };
}
