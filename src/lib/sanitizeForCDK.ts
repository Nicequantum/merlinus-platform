const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
/** Final gate — only CDK-safe characters may pass. */
const CDK_ALLOWED_PATTERN = /[A-Za-z0-9 .,\-]/g;

export interface CDKSanitizeResult {
  text: string;
  wasModified: boolean;
}

/**
 * Strip/replace all characters unsafe for CDK DMS text fields.
 * Allowed: A-Z, a-z, 0-9, spaces, period, comma, hyphen.
 */
export function sanitizeForCDK(text: string): string {
  return sanitizeForCDKWithMeta(text).text;
}

/** Sanitize and report whether the output differs from the input. */
export function sanitizeForCDKWithMeta(text: string): CDKSanitizeResult {
  if (typeof text !== 'string') {
    return { text: '', wasModified: text !== '' };
  }

  const original = text;
  let result = text
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL_CHARS, '')
    .replace(/[\u2013\u2014]/g, '-');

  // Paragraph and line breaks become CDK-safe separators.
  result = result.replace(/\n\s*\n+/g, '. ');
  result = result.replace(/\n/g, ' ');

  // Drop every character outside the CDK whitelist.
  result = (result.match(CDK_ALLOWED_PATTERN) ?? []).join('');

  result = result
    .replace(/ +/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+([.,])/g, '$1')
    .replace(/([.,])\s*([.,])/g, '$1')
    .replace(/\s+-\s+/g, '-')
    .trim();

  return { text: result, wasModified: result !== original };
}