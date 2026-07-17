/**
 * Safety net + deterministic editor for story revision after Add Tech Details.
 * Primary path for regenerate reliability: integrate corrections into prior story.
 */

import { appendUniqueDetailText } from '@/lib/storyDetailText';
import {
  integrateTechnicianDetailsIntoStory,
  toAuditCorrection,
  weaveCorrectionIntoStory,
} from '@/lib/storyAuditIntegration';
import type { TechnicianDetailPrompt } from '@/types';
import {
  AUDIT_ENHANCEMENT_NOTES_MARKER,
  PENDING_CORRECTIONS_END,
  PENDING_CORRECTIONS_START,
} from '@/prompts/story/shared/regenerateRules';

/** Distinctive technical tokens that must survive a revision. */
export function extractTechnicalTokens(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\b[PBCU]\d{4}[A-Z]?\b/gi,
    /\b\d{1,2}\.\d{1,2}\s*V\b/gi,
    /\bN\d+\/\d+\b/gi,
    /\bB\d+\/\d+\b/gi,
    /\bY\d+\/\d+\b/gi,
    /\b\d{5,}\b/g,
    /\b[A-Z]{1,3}\d{1,3}\/\d+\b/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      found.add(m[0]);
    }
  }
  return [...found];
}

function normalizeLoose(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True if a correction's distinctive content appears in the story. */
export function storyContainsCorrection(story: string, correction: string): boolean {
  const s = normalizeLoose(story);
  const c = normalizeLoose(correction);
  if (!c || c.length < 4) return true;
  if (s.includes(c)) return true;

  const tokens = extractTechnicalTokens(correction);
  if (tokens.length > 0) {
    const hit = tokens.filter((t) => s.includes(t.toLowerCase()));
    if (hit.length >= Math.min(tokens.length, 2) || (tokens.length === 1 && hit.length === 1)) {
      return true;
    }
  }

  const words = c
    .split(/[^a-z0-9./-]+/)
    .filter((w) => w.length >= 5)
    .slice(0, 8);
  if (words.length === 0) return false;
  const hits = words.filter((w) => s.includes(w)).length;
  return hits >= Math.ceil(words.length * 0.55);
}

/** Parse pending correction lines from notes fenced block + [Audit enhancement] lines. */
export function extractRequiredCorrectionsFromNotes(notes: string): string[] {
  const out: string[] = [];
  const start = notes.indexOf(PENDING_CORRECTIONS_START);
  const end = notes.indexOf(PENDING_CORRECTIONS_END);
  if (start >= 0 && end > start) {
    const body = notes.slice(start + PENDING_CORRECTIONS_START.length, end);
    for (const line of body.split(/\n/)) {
      const cleaned = line.replace(/^\d+\.\s*/, '').trim();
      if (cleaned) out.push(cleaned);
    }
  }
  // Legacy angle-bracket fences (pre-sanitize-safe markers)
  const legacyStart = notes.indexOf('<<<PENDING_AUDIT_CORRECTIONS>>>');
  const legacyEnd = notes.indexOf('<<<END_PENDING_AUDIT_CORRECTIONS>>>');
  if (legacyStart >= 0 && legacyEnd > legacyStart) {
    const body = notes.slice(legacyStart + '<<<PENDING_AUDIT_CORRECTIONS>>>'.length, legacyEnd);
    for (const line of body.split(/\n/)) {
      const cleaned = line.replace(/^\d+\.\s*/, '').trim();
      if (cleaned) out.push(cleaned);
    }
  }
  for (const line of notes.split(/\n/)) {
    const t = line.trim();
    if (t.includes(AUDIT_ENHANCEMENT_NOTES_MARKER)) {
      out.push(t.replace(AUDIT_ENHANCEMENT_NOTES_MARKER, '').trim());
    }
  }
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = normalizeLoose(c);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Insert a single correction into the story at a sensible workflow location
 * using the same audit-recognizable prose as Add Tech Details.
 */
export function insertCorrectionIntoStory(story: string, correction: string): string {
  const detail: TechnicianDetailPrompt = {
    missing: correction.slice(0, 120),
    prompt: correction,
    field: 'workflow',
  };
  const audit = toAuditCorrection(detail);
  if (!audit) return story;
  if (storyContainsCorrection(story, audit.prose)) return story;
  return weaveCorrectionIntoStory(story, audit);
}

/**
 * Deterministic editor: keep prior story, surgically integrate every correction.
 * Delegates to workflow-aware integration so MI audit can credit the fixes.
 */
export function applyCorrectionsToStoryDeterministically(
  priorStory: string,
  corrections: string[]
): string {
  const details: TechnicianDetailPrompt[] = corrections.map((c) => ({
    missing: c.slice(0, 120),
    prompt: c,
    field: 'workflow' as const,
  }));
  return integrateTechnicianDetailsIntoStory(priorStory, details);
}

/**
 * Ensure regenerated text keeps prior technical tokens and required corrections.
 */
export function ensureStoryPreservesPriorAndCorrections(
  priorStory: string,
  regenerated: string,
  corrections: string[]
): string {
  const prior = priorStory.trim();
  let result = regenerated.trim();

  if (!result) return applyCorrectionsToStoryDeterministically(prior, corrections);
  if (!prior) return applyCorrectionsToStoryDeterministically(result, corrections);

  // Catastrophic shrink — keep prior and apply corrections.
  if (result.length < prior.length * 0.7) {
    return applyCorrectionsToStoryDeterministically(prior, corrections);
  }

  const priorTokens = extractTechnicalTokens(prior);
  const missingTokens = priorTokens.filter(
    (t) => !result.toLowerCase().includes(t.toLowerCase())
  );
  if (
    missingTokens.length > 0 &&
    missingTokens.length >= Math.max(1, Math.ceil(priorTokens.length * 0.2))
  ) {
    // Too many lost tokens — deterministic base from prior
    return applyCorrectionsToStoryDeterministically(prior, corrections);
  }

  // Re-apply any missing corrections into the AI result
  for (const c of corrections) {
    result = insertCorrectionIntoStory(result, c);
  }

  // Restore vanished tokens as a last resort
  const stillMissing = priorTokens.filter((t) => !result.toLowerCase().includes(t.toLowerCase()));
  if (stillMissing.length > 0) {
    result = appendUniqueDetailText(
      result,
      `Documented values retained from prior narrative: ${stillMissing.join(', ')}.`
    );
  }

  return result;
}

/** Build fenced pending-corrections block for notes (regen input). */
export function formatPendingCorrectionsBlock(details: TechnicianDetailPrompt[]): string {
  if (!details.length) return '';
  const lines = details.map((d, i) => {
    const body =
      d.missing && d.prompt && !d.prompt.toLowerCase().includes(d.missing.toLowerCase().slice(0, 20))
        ? `${d.missing}: ${d.prompt}`
        : d.prompt || d.missing;
    return `${i + 1}. ${body.trim()}`;
  });
  return `${PENDING_CORRECTIONS_START}\n${lines.join('\n')}\n${PENDING_CORRECTIONS_END}`;
}

/** Merge or replace the pending corrections fence in notes. */
export function mergePendingCorrectionsIntoNotes(
  existingNotes: string,
  details: TechnicianDetailPrompt[]
): string {
  if (!details.length) return existingNotes;
  const block = formatPendingCorrectionsBlock(details);
  let base = existingNotes.trim();
  // Remove legacy angle-bracket fences if present
  base = base
    .replace(
      /<<<PENDING_AUDIT_CORRECTIONS>>>[\s\S]*?<<<END_PENDING_AUDIT_CORRECTIONS>>>/g,
      ''
    )
    .trim();
  const start = base.indexOf(PENDING_CORRECTIONS_START);
  const end = base.indexOf(PENDING_CORRECTIONS_END);
  if (start >= 0 && end > start) {
    const before = base.slice(0, start).trimEnd();
    const after = base.slice(end + PENDING_CORRECTIONS_END.length).trimStart();
    return [before, block, after].filter(Boolean).join('\n\n');
  }
  return base ? `${base}\n\n${block}` : block;
}
