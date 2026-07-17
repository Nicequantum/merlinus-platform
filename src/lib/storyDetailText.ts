/**
 * Shared text helpers for tech-detail inserts (no imports from regenerate guard / apply).
 * Keeps circular dependencies out of the generate path.
 */

import type { TechnicianDetailPrompt } from '@/types';

/** Append text once (no-op if already present). */
export function appendUniqueDetailText(existing: string, addition: string): string {
  const text = addition.trim();
  if (!text) return existing;
  const base = existing.trim();
  if (!base) return text;
  if (base.includes(text)) return existing;
  if (text.length > 40 && base.includes(text.slice(0, Math.min(80, text.length)))) {
    return existing;
  }
  return `${base}\n\n${text}`;
}

/** Human-readable insert for notes fields. */
export function formatTechnicianDetailInsert(detail: TechnicianDetailPrompt): string {
  const prompt = detail.prompt?.trim() || '';
  const missing = detail.missing?.trim() || '';
  if (prompt && missing && !prompt.toLowerCase().includes(missing.toLowerCase().slice(0, 24))) {
    return `${missing}\n${prompt}`;
  }
  return prompt || missing;
}

/**
 * Story-ready prose for the warranty narrative.
 * Converts coaching imperatives into documented technician language.
 */
export function formatTechnicianDetailForStory(detail: TechnicianDetailPrompt): string {
  const missing = detail.missing?.trim() || '';
  let body = (detail.prompt?.trim() || missing).trim();
  if (!body) return '';

  body = body
    .replace(
      /^(please\s+)?(add|document|include|record|insert|provide|note|mention|list|write|enter)\s+(the\s+)?/i,
      ''
    )
    .replace(/^(that\s+)?(you\s+)?(should\s+)?/i, '')
    .trim();

  if (!body) body = missing;
  if (!body) return '';

  body = body.charAt(0).toUpperCase() + body.slice(1);
  if (!/[.!?]$/.test(body)) body = `${body}.`;

  if (missing && !body.toLowerCase().includes(missing.toLowerCase().slice(0, 20))) {
    return `${missing}: ${body}`;
  }
  return body;
}
