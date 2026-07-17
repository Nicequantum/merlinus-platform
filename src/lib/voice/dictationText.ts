import { applySpokenPunctuation, normalizeDictationSpacing, type VoiceDictationMode } from './dictationPunctuation';

function chunkStartsWithPunctuation(chunk: string): boolean {
  const trimmed = chunk.trimStart();
  return /^[.,!?;:'"()\[\]{}…\-]/.test(trimmed) || trimmed.startsWith('\n');
}

/** Join finalized speech chunks with a space when the engine omits word boundaries. */
export function appendDictationChunk(base: string, chunk: string): string {
  if (!chunk) return base;
  if (!base) return chunk;
  if (/\s$/.test(base) || /^\s/.test(chunk)) return base + chunk;
  if (chunkStartsWithPunctuation(chunk)) return base + chunk;
  return `${base} ${chunk}`;
}

/** Apply story punctuation commands, then merge a chunk into committed dictation text. */
export function processDictationChunk(
  base: string,
  chunk: string,
  mode: VoiceDictationMode = 'default',
  speechLang?: string | null
): string {
  const normalized = applySpokenPunctuation(chunk, mode, speechLang);
  const merged = appendDictationChunk(base, normalized);
  return mode === 'story' ? normalizeDictationSpacing(merged) : merged;
}