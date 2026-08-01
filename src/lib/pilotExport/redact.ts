import { createHash } from 'crypto';
import { redactForLog } from '@/lib/logRedact';

/** Stable non-reversible id for emails (migration join key without storing PII). */
export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash('sha256').update(`pilot-export:email:${normalized}`).digest('hex').slice(0, 24);
}

export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // IPv4 → a.b.c.0 ; IPv6 → first 4 hextets
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (ip.includes(':')) {
    return ip.split(':').slice(0, 4).join(':') + '::';
  }
  return '[ip]';
}

export function scrubMetadata(raw: string | unknown): Record<string, unknown> {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { _parseError: true };
    }
  }
  const redacted = redactForLog(
    typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : { value: obj }
  );
  return (redacted || {}) as Record<string, unknown>;
}
