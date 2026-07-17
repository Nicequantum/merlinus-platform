/** Field caps — enough diagnostic context without bloating the user message. */
export const PROMPT_FIELD_LIMITS = {
  ocr: 500,
  /** Raised so "Add Tech Details" appends are not chopped off at the end. */
  notes: 2_500,
  concern: 600,
  /** Prior story on revision passes — full narrative for intelligent rewrite. */
  priorStory: 6_000,
} as const;

/**
 * Truncate for prompts.
 * preferEnd=true keeps the newest content (tech-detail appends land at the end).
 */
export function truncatePromptField(
  text: string,
  maxLen: number,
  options?: { preferEnd?: boolean }
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  if (options?.preferEnd) {
    return `…${trimmed.slice(-(maxLen - 1))}`;
  }
  return `${trimmed.slice(0, maxLen)}…`;
}
