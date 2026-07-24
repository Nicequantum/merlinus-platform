/**
 * Phase 7.2 (H8) — central secret / PII redaction for logs and Sentry.
 */

const SENSITIVE_KEY =
  /^(password|passwordHash|passwd|secret|token|apiKey|api_key|authorization|cookie|set-cookie|vin|customerName|warrantyStory|storyText|technicianNotes|displayName|serviceAdvisorName|complaints?|DATABASE_URL|DIRECT_URL|SESSION_SECRET|DATA_ENCRYPTION_KEY|SEARCH_HMAC_KEY|GROK_API_KEY(?:_1|_2)?|XAI_API_KEY|KV_REST_API_TOKEN|BLOB_READ_WRITE_TOKEN|CLERK_SECRET_KEY)$/i;

const BEARER_RE = /Bearer\s+\S+/gi;
const XAI_KEY_RE = /xai-[a-zA-Z0-9_-]+/gi;
const BLOB_TOKEN_RE = /vercel_blob_rw_\S+/gi;
const JWT_RE = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const PG_URL_RE = /(postgres(?:ql)?:\/\/)([^:@\s]+):([^@\s]+)@/gi;
const ENV_NAME_RE =
  /\b(BLOB_READ_WRITE_TOKEN|GROK_API_KEY(?:_1|_2)?|XAI_API_KEY|KV_REST_API_(?:URL|TOKEN)|DATA_ENCRYPTION_KEY|SEARCH_HMAC_KEY|SESSION_SECRET|DATABASE_URL|CLERK_SECRET_KEY)\b/g;

const MAX_STRING = 800;

/** Redact secrets in a free-form string (logs, error messages). */
export function redactString(value: string, maxLen = MAX_STRING): string {
  let out = value
    .replace(BEARER_RE, 'Bearer [redacted]')
    .replace(XAI_KEY_RE, 'xai-[redacted]')
    .replace(BLOB_TOKEN_RE, 'vercel_blob_rw_[redacted]')
    .replace(JWT_RE, '[jwt-redacted]')
    .replace(PG_URL_RE, '$1$2:[redacted]@')
    .replace(ENV_NAME_RE, '[env]')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  if (out.length > maxLen) {
    out = `${out.slice(0, maxLen)}…`;
  }
  return out;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6) return '[max-depth]';
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack, 1200) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = '[Redacted]';
      } else {
        out[key] = redactValue(child, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/** Deep-redact a log/Sentry context object. */
export function redactForLog(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context || Object.keys(context).length === 0) return undefined;
  return redactValue(context, 0) as Record<string, unknown>;
}

/** Technician-safe public message — strip env var names from client-facing text. */
export function publicSafeMessage(message: string): string {
  return message
    .replace(/\bBLOB_READ_WRITE_TOKEN\b/g, 'photo storage credentials')
    .replace(/\bGROK_API_KEY(?:_1|_2)?\b/g, 'AI credentials')
    .replace(/\bXAI_API_KEY\b/g, 'AI credentials')
    .replace(/\bKV_REST_API_(?:URL|TOKEN)\b/g, 'rate-limit store credentials')
    .replace(/\bDATA_ENCRYPTION_KEY\b/g, 'encryption credentials')
    .replace(/\bSESSION_SECRET\b/g, 'session credentials');
}
