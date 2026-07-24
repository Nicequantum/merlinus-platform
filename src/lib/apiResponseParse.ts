/**
 * P0-4 — Client-side parsing of API error bodies.
 * Handles JSON `{ error }` and non-JSON (HTML Worker/edge error pages) without
 * throwing SyntaxError into the UI.
 */

export const NON_JSON_API_ERROR_MESSAGE =
  'Service temporarily unavailable. Check your connection and try again.';

/** Prefer status-aware copy so bay techs / ops can distinguish 503 storage vs network. */
export function nonJsonApiErrorMessage(status?: number): string {
  if (status && status > 0) {
    return `Service temporarily unavailable (HTTP ${status}). Check your connection and try again.`;
  }
  return NON_JSON_API_ERROR_MESSAGE;
}

export interface ParsedApiErrorBody {
  /** User-safe message */
  message: string;
  /** True when response was not application/json (or body was not JSON object) */
  nonJson: boolean;
  /** Optional machine code from JSON body */
  code?: string;
  requestId?: string;
  /** HTTP status when known (helps ops + client logs) */
  status?: number;
}

function looksLikeHtml(text: string): boolean {
  const t = text.trimStart().slice(0, 64).toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<head');
}

/**
 * Parse an error Response into a stable user-facing message.
 * Never throws.
 */
export async function parseApiErrorResponse(
  res: Response,
  fallbackMessage = 'Request failed. Please try again.'
): Promise<ParsedApiErrorBody> {
  const contentType = res.headers.get('content-type') || '';
  const isJsonHeader = contentType.toLowerCase().includes('application/json');

  let text = '';
  try {
    text = await res.text();
  } catch {
    return {
      message: `${fallbackMessage} (HTTP ${res.status})`,
      nonJson: true,
      status: res.status,
    };
  }

  if (!text.trim()) {
    return {
      message:
        res.status >= 500
          ? nonJsonApiErrorMessage(res.status)
          : `${fallbackMessage} (HTTP ${res.status})`,
      nonJson: !isJsonHeader,
      status: res.status,
    };
  }

  if (looksLikeHtml(text) || (!isJsonHeader && text.trimStart().startsWith('<'))) {
    return {
      message: nonJsonApiErrorMessage(res.status),
      nonJson: true,
      status: res.status,
    };
  }

  try {
    const data = JSON.parse(text) as {
      error?: unknown;
      message?: unknown;
      code?: unknown;
      requestId?: unknown;
    };
    if (data && typeof data === 'object') {
      const err =
        (typeof data.error === 'string' && data.error.trim()) ||
        (typeof data.message === 'string' && data.message.trim()) ||
        '';
      return {
        message: err || `${fallbackMessage} (HTTP ${res.status})`,
        nonJson: false,
        code: typeof data.code === 'string' ? data.code : undefined,
        requestId: typeof data.requestId === 'string' ? data.requestId : undefined,
        status: res.status,
      };
    }
  } catch {
    // fall through
  }

  // Non-JSON text body (plain text error, CF ray pages, etc.)
  if (!isJsonHeader || looksLikeHtml(text)) {
    return {
      message: nonJsonApiErrorMessage(res.status),
      nonJson: true,
      status: res.status,
    };
  }

  return {
    message: `${fallbackMessage} (HTTP ${res.status})`,
    nonJson: true,
    status: res.status,
  };
}

/**
 * Parse a successful or failed Response body as JSON.
 * On non-JSON success bodies returns null (caller decides).
 * On error responses uses parseApiErrorResponse semantics via thrown Error message.
 */
export async function readJsonBodySafe<T>(
  res: Response
): Promise<{ ok: true; data: T } | { ok: false; error: ParsedApiErrorBody }> {
  if (!res.ok) {
    return { ok: false, error: await parseApiErrorResponse(res) };
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text().catch(() => '');
  if (!text.trim()) {
    return { ok: true, data: {} as T };
  }

  if (!contentType.toLowerCase().includes('application/json') && text.trimStart().startsWith('<')) {
    return {
      ok: false,
      error: {
        message: nonJsonApiErrorMessage(res.status),
        nonJson: true,
        status: res.status,
      },
    };
  }

  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return {
      ok: false,
      error: {
        message: nonJsonApiErrorMessage(res.status),
        nonJson: true,
        status: res.status,
      },
    };
  }
}
