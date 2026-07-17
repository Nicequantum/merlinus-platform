import type { VoiceDictationMode } from './types';

export type { VoiceDictationMode };

/** Spoken phrases → punctuation (longer phrases first). */
const SPOKEN_PUNCTUATION: ReadonlyArray<{ pattern: RegExp; replace: string }> = [
  { pattern: /\bnew\s+paragraph\b/gi, replace: '\n\n' },
  { pattern: /\bnext\s+paragraph\b/gi, replace: '\n\n' },
  { pattern: /\bparagraph\s+break\b/gi, replace: '\n\n' },
  { pattern: /\bnew\s+line\b/gi, replace: '\n' },
  { pattern: /\bline\s+break\b/gi, replace: '\n' },
  { pattern: /\bnext\s+line\b/gi, replace: '\n' },
  { pattern: /\bquestion\s+mark\b/gi, replace: '?' },
  { pattern: /\bexclamation\s+(?:mark|point)\b/gi, replace: '!' },
  { pattern: /\bopen\s+parenthesis\b/gi, replace: '(' },
  { pattern: /\bclose\s+parenthesis\b/gi, replace: ')' },
  { pattern: /\bopen\s+quote\b/gi, replace: '"' },
  { pattern: /\bclose\s+quote\b/gi, replace: '"' },

  { pattern: /\bfull\s+stop\b/gi, replace: '.' },
  { pattern: /\bperiod\b/gi, replace: '.' },
  { pattern: /\bcomma\b/gi, replace: ',' },
  { pattern: /\bsemicolon\b/gi, replace: ';' },
  { pattern: /\bcolon\b/gi, replace: ':' },
  { pattern: /\bellips(?:is|es)\b/gi, replace: '…' },
  { pattern: /\bdash\b/gi, replace: '-' },
  { pattern: /\bhyphen\b/gi, replace: '-' },
];

/** Normalize spacing around punctuation and paragraph breaks after spoken-command substitution. */
export function normalizeDictationSpacing(text: string): string {
  let result = text;
  result = result.replace(/\s+([.,!?;:])/g, '$1');
  result = result.replace(/([.,!?;:])(?=[A-Za-z0-9])/g, '$1 ');
  result = result.replace(/[^\S\n]+/g, ' ');
  result = result.replace(/ *\n */g, '\n');
  result = result.replace(/\n{3,}/g, '\n\n');
  return result;
}

/**
 * Convert spoken punctuation commands in a recognition chunk (story/narrative fields).
 * Phase 1: English command phrases only — skip when STT language is not English
 * so Spanish speech is not corrupted by accidental EN command matches.
 */
export function applySpokenPunctuation(
  text: string,
  mode: VoiceDictationMode,
  speechLang?: string | null
): string {
  if (mode !== 'story' || !text) return text;
  const lang = (speechLang || 'en').toLowerCase();
  if (!lang.startsWith('en')) {
    return normalizeDictationSpacing(text);
  }
  let result = text;
  for (const { pattern, replace } of SPOKEN_PUNCTUATION) {
    result = result.replace(pattern, replace);
  }
  return normalizeDictationSpacing(result);
}