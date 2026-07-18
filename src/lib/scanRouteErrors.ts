import { IMAGE_STORAGE_ERROR } from './errors';

/** Route keys for photo upload + vision extract — must not return GENERIC_ERROR. */
export const SCAN_ROUTE_KEYS = new Set(['upload', 'ro.extract', 'diagnostics.extract']);

export interface RouteErrorMapping {
  message: string;
  status: number;
  logDetail: string;
}

/** Structured scan failure — surfaces a technician-safe message with HTTP status. */
export class ScanRouteError extends Error {
  readonly status: number;
  readonly logDetail: string;

  constructor(message: string, status: number, logDetail?: string) {
    super(message);
    this.name = 'ScanRouteError';
    this.status = status;
    this.logDetail = logDetail ?? message;
  }
}

export function isScanRouteContext(context: string): boolean {
  return SCAN_ROUTE_KEYS.has(context);
}

/** Redact secrets and cap length for logs and API responses. */
export function sanitizeScanErrorDetail(value: string, maxLen = 280): string {
  let detail = value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/xai-[a-zA-Z0-9_-]+/gi, 'xai-[redacted]')
    .replace(/\bR2_SECRET_ACCESS_KEY\b/g, '[redacted]')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();

  if (detail.length > maxLen) {
    detail = `${detail.slice(0, maxLen)}…`;
  }
  return detail;
}

/** Parse xAI error JSON/text for a short technician-safe detail string. */
export function parseGrokApiErrorBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: string | { message?: string; code?: string };
      message?: string;
    };
    if (typeof parsed.error === 'string') {
      return sanitizeScanErrorDetail(parsed.error);
    }
    if (parsed.error && typeof parsed.error === 'object') {
      const parts = [parsed.error.message, parsed.error.code].filter(Boolean).join(' — ');
      if (parts) return sanitizeScanErrorDetail(parts);
    }
    if (typeof parsed.message === 'string') {
      return sanitizeScanErrorDetail(parsed.message);
    }
  } catch {
    // fall through to raw text
  }

  return sanitizeScanErrorDetail(trimmed, 200);
}

export function mapBlobRouteError(error: unknown, operation: 'upload' | 'fetch'): RouteErrorMapping {
  const raw = error instanceof Error ? error.message : String(error);
  const logDetail = sanitizeScanErrorDetail(raw, 500);

  if (
    raw.includes('APEX_R2') ||
    raw.includes('object storage') ||
    raw.includes('R2 binding') ||
    // Legacy Vercel Blob misconfig string (still redacted in public messages)
    raw.includes('BLOB_READ_WRITE_TOKEN')
  ) {
    return {
      // Phase 7.2 — no env var names in technician-facing copy
      message: 'Photo storage is not configured. Contact your service manager.',
      status: 503,
      logDetail,
    };
  }

  if (raw.includes('Invalid image pathname')) {
    return {
      message: 'Invalid photo reference. Please re-upload the image.',
      status: 400,
      logDetail,
    };
  }

  if (/not found/i.test(raw)) {
    return {
      message:
        operation === 'upload'
          ? `Photo upload failed — storage could not save the file: ${sanitizeScanErrorDetail(raw)}`
          : `${IMAGE_STORAGE_ERROR} ${sanitizeScanErrorDetail(raw)}`,
      status: 502,
      logDetail,
    };
  }

  const prefix = operation === 'upload' ? 'Photo upload failed' : 'Could not load uploaded photo';
  return {
    message: `${prefix}: ${sanitizeScanErrorDetail(raw)}`,
    status: 502,
    logDetail,
  };
}

export function mapAuditRouteError(error: unknown): RouteErrorMapping {
  const raw = error instanceof Error ? error.message : String(error);
  const logDetail = sanitizeScanErrorDetail(raw, 500);
  return {
    message: `Photo upload could not be recorded for scanning: ${sanitizeScanErrorDetail(raw)}`,
    status: 503,
    logDetail,
  };
}

export function mapGrokRouteError(error: unknown, featureLabel: string): RouteErrorMapping {
  const message = error instanceof Error ? error.message : `${featureLabel} failed`;
  const logDetail = sanitizeScanErrorDetail(message, 500);

  const grokMatch = message.match(/^Grok API error: (\d{3})(?:\s*[—-]\s*(.+))?$/);
  if (grokMatch) {
    const statusCode = Number(grokMatch[1]);
    const detail = grokMatch[2]?.trim();
    const detailSuffix = detail ? ` — ${detail}` : '';

    if (statusCode === 429) {
      return {
        message: `AI service is busy (HTTP 429).${detailSuffix}`,
        status: 429,
        logDetail,
      };
    }
    if (statusCode === 401 || statusCode === 403) {
      const protection =
        /protect(ed|ion)|deployment protection|authentication required|vercel/i.test(
          detail || message
        );
      return {
        message: protection
          ? `${featureLabel} failed — AI gateway blocked (HTTP ${statusCode} deployment protection).${detailSuffix} Contact your service manager.`
          : `${featureLabel} failed — AI API key rejected (HTTP ${statusCode}).${detailSuffix} Contact your service manager.`,
        status: 503,
        logDetail,
      };
    }
    if (statusCode >= 500) {
      return {
        message: `${featureLabel} failed — AI service error (HTTP ${statusCode}).${detailSuffix}`,
        status: 503,
        logDetail,
      };
    }
    return {
      message: `${featureLabel} failed (HTTP ${statusCode}).${detailSuffix}`,
      status: 502,
      logDetail,
    };
  }

  if (
    message.includes('GROK_API_KEY') ||
    message.includes('NEXT_PUBLIC_GROK') ||
    message.includes('NEXT_PUBLIC_XAI') ||
    /not configured/i.test(message)
  ) {
    return {
      // Phase 7.2 — no env var names / key material in technician-facing copy
      message: `${featureLabel} is unavailable — AI service is not configured. Contact your service manager.`,
      status: 503,
      logDetail,
    };
  }

  if (message.toLowerCase().includes('timed out') || message.includes('AbortError')) {
    return {
      message: `${featureLabel} timed out — try again in a moment. (${sanitizeScanErrorDetail(message)})`,
      status: 504,
      logDetail,
    };
  }

  if (/could not parse/i.test(message)) {
    return {
      message: `${featureLabel} — AI returned unreadable data. Try a sharper photo. (${sanitizeScanErrorDetail(message)})`,
      status: 502,
      logDetail,
    };
  }

  return {
    message: message.startsWith(featureLabel)
      ? sanitizeScanErrorDetail(message)
      : `${featureLabel}: ${sanitizeScanErrorDetail(message)}`,
    status: 502,
    logDetail,
  };
}

export function mapScanRouteError(error: unknown, context: string): RouteErrorMapping {
  if (error instanceof ScanRouteError) {
    return {
      message: error.message,
      status: error.status,
      logDetail: error.logDetail,
    };
  }

  const raw = error instanceof Error ? error.message : String(error);
  const logDetail = sanitizeScanErrorDetail(raw, 500);

  if (
    raw.includes('APEX_R2') ||
    raw.includes('object storage') ||
    raw.includes('BLOB_READ_WRITE_TOKEN') ||
    /r2 binding|blob storage|blob upload/i.test(raw)
  ) {
    const operation = context === 'upload' ? 'upload' : 'fetch';
    return mapBlobRouteError(error, operation);
  }

  if (/audit/i.test(raw)) {
    return mapAuditRouteError(error);
  }

  if (raw.includes('Grok API') || raw.includes('GROK_API_KEY') || raw.includes('xAI')) {
    const label =
      context === 'ro.extract'
        ? 'Repair order scan'
        : context === 'diagnostics.extract'
          ? 'Diagnostic scan'
          : 'Scan';
    return mapGrokRouteError(error, label);
  }

  const cleaned = sanitizeScanErrorDetail(raw);
  return {
    message: cleaned || 'Scan failed with an unknown server error.',
    status: 500,
    logDetail,
  };
}