import { sanitizeIdentifier, sanitizeText } from '@/lib/sanitize';

/** Fields that must never appear in technician activity logs. */
const BLOCKED_KEYS = new Set([
  'name',
  'displayName',
  'serviceAdvisorName',
  'customerName',
  'warrantyStory',
  'storyText',
  'technicianNotes',
  'vin',
  'password',
  'passwordHash',
  'complaint',
  'complaintText',
]);

const ALLOWED_PRIMITIVE_KEYS = new Set([
  'role',
  'event',
  'appVersion',
  'clientSessionId',
  'repairOrderId',
  'repairLineId',
  'lineNumber',
  'roNumber',
  'promptVersion',
  'qualityScore',
  'qualityGrade',
  'cdkSanitized',
  'storyHash',
  'reviewMode',
  'certifiedAt',
  'todayRoCount',
  'previousRoCount',
  'durationMs',
  'model',
]);

export function sanitizeTechnicianLogMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!metadata) return {};

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (BLOCKED_KEYS.has(key)) continue;

    if (key.endsWith('Id') && typeof value === 'string') {
      sanitized[key] = sanitizeIdentifier(value);
      continue;
    }

    if (ALLOWED_PRIMITIVE_KEYS.has(key)) {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeText(value).slice(0, 200);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value;
      }
      continue;
    }
  }

  return sanitized;
}