/**
 * Outbound SMS for video inspection customer links.
 * Disabled unless SMS_ENABLED=true and Twilio credentials are set.
 */

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
    throw new Error('SMS is not configured. Set SMS_ENABLED=true and Twilio credentials.');
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

  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok || !data.sid) {
    throw new Error(data.message || `SMS send failed (${res.status})`);
  }
  return { sid: data.sid };
}
