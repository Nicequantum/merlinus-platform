/**
 * Outbound SMS for video inspection customer links.
 *
 * Required env (all must be set for real delivery — no fake SMS path):
 * - SMS_ENABLED=true (or 1 / yes)
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - TWILIO_FROM_NUMBER (E.164 Twilio From / Messaging Service compatible number)
 *
 * Disabled unless SMS_ENABLED is explicitly true AND all three Twilio vars are present.
 */

import { logger } from '@/lib/logger';

export function isSmsEnabled(): boolean {
  const flag = process.env.SMS_ENABLED?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  if (flag !== '1' && flag !== 'true' && flag !== 'yes') {
    // Default off unless explicitly enabled
    return false;
  }
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim()
  );
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

export async function sendSms(to: string, body: string): Promise<{ sid: string }> {
  if (!isSmsEnabled()) {
    throw new Error(
      'SMS is not configured. Set SMS_ENABLED=true, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.'
    );
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  const from = process.env.TWILIO_FROM_NUMBER!.trim();
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
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
      twilioCode: data.code ?? null,
      twilioMessage: data.message || data.error_message || null,
      moreInfo: data.more_info ?? null,
      toLast4: to.slice(-4),
      fromLast4: from.slice(-4),
    });
    const detail = data.message || data.error_message || `SMS send failed (${res.status})`;
    throw new Error(detail);
  }
  return { sid: data.sid };
}
