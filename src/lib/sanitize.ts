const HTML_TAG = /<[^>]*>/g;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const DANGEROUS_PROTOCOLS = /(?:javascript|vbscript|data)\s*:/gi;
const EVENT_HANDLERS = /\bon\w+\s*=/gi;

/** Strip HTML, control chars, and common XSS vectors from user-supplied text. */
export function sanitizeText(value: string): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, '')
    .replace(HTML_TAG, '')
    .replace(DANGEROUS_PROTOCOLS, '')
    .replace(EVENT_HANDLERS, '')
    .trim();
}

export function sanitizeTextArray(values: string[]): string[] {
  return values.map(sanitizeText).filter((item) => item.length > 0);
}

/** Preserve empty complaint slots so in-progress edits are not dropped on save. */
export function sanitizeComplaintSlots(values: string[]): string[] {
  return values.map(sanitizeText);
}

/** VIN: uppercase alphanumeric only (no I/O/Q per standard, but we allow decoder to validate). */
export function sanitizeVin(value: string): string {
  return value.replace(/[^A-HJ-NPR-Za-hj-npr-z0-9]/g, '').toUpperCase().slice(0, 17);
}

/** RO numbers and short identifiers — printable ASCII without angle brackets. */
export function sanitizeIdentifier(value: string): string {
  return sanitizeText(value).replace(/[<>'"`]/g, '').trim();
}