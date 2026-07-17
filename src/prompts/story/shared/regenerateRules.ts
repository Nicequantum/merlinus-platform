/**
 * Conservative edit mode when improving an existing warranty story after
 * "Add Tech Details" / audit coaching.
 *
 * Fence markers intentionally avoid raw HTML-like <...> so sanitizeText()
 * (which strips tags) cannot destroy pending corrections on RO save.
 */

export const STORY_REGENERATE_SYSTEM_ADDENDUM = `EDITING MODE (mandatory when a current story is provided):
You are a senior warranty professor editing a technician's draft for a higher audit score.

YOU ARE NOT writing a new story from scratch. You are correcting and strengthening the existing document.

HARD RULES:
1. Start from the CURRENT STORY as the base document. Keep its structure, chronology, and voice unless a correction requires a local change.
2. NEVER remove, weaken, or omit any technical detail already present (codes, voltages, part/control-unit numbers, measurements, guided tests, miles, steps already documented). Small tokens matter (dashes, slashes, decimals).
3. Apply ONLY the REQUIRED CORRECTIONS / audit enhancements: insert or fix the specific missing facts in the correct workflow place.
4. Integrate corrections as natural first-person technician prose in-flow — not as a bullet list or appendix at the end.
5. When a correction addresses something marked [NOT DOCUMENTED], replace that placeholder with the real documented detail.
6. Do not invent codes, measurements, tests, or parts that are not in the current story, notes, diagnostics, or required corrections.
7. Prefer equal or higher completeness than the current story. A shorter, thinner story is a failure.
8. Output ONLY the full improved warranty narrative (complete document).
9. The improved story must remain professional English only (even if required corrections or notes are in another language).`;

/** Marker when a single tech-detail coaching item is applied to notes. */
export const AUDIT_ENHANCEMENT_NOTES_MARKER = '[Audit enhancement]';

/**
 * Fenced block of pending corrections for regenerate.
 * Uses === delimiters (not <...>) so HTML sanitizers cannot strip them.
 */
export const PENDING_CORRECTIONS_START = '===PENDING_AUDIT_CORRECTIONS===';
export const PENDING_CORRECTIONS_END = '===END_PENDING_AUDIT_CORRECTIONS===';

/** User-message header for conservative edit passes. */
export const STORY_REGENERATE_USER_HEADER = `EDITING PASS — improve the existing warranty story like a professor correcting a paper. Preserve every existing detail. Apply only the required corrections. Never rewrite from scratch. Never drop content.`;
