/**
 * Per-generation style variation so warranty stories from many technicians
 * do not share identical phrasing patterns (Benz Bot 2.0 evasion).
 */

const SENTENCE_RHYTHM = [
  'Mix short, direct sentences with occasional longer explanatory ones — avoid uniform length across paragraphs.',
  'Favor crisp single-clause statements; use a longer sentence only when connecting cause to evidence.',
  'Open some paragraphs with findings or measurements, others with the customer symptom or test action.',
  'Vary paragraph length: one tight paragraph, then a fuller diagnostic paragraph, then a concise close.',
] as const;

const DETAIL_LEVEL = [
  'Include specific codes, voltages, and guided-test outcomes when documented; keep narrative tight elsewhere.',
  'Emphasize the diagnostic reasoning chain — explain why each test mattered, not just that it was performed.',
  'Foreground repair and verification steps with measured, factual language; summarize earlier workflow steps briefly.',
  'Balance shop-floor brevity with enough technical specificity that every workflow step is evidenced.',
] as const;

const INFORMATION_ORDER = [
  'After confirming the complaint, walk diagnostics in strict workflow order before stating cause and correction.',
  'Establish the customer concern, then interleave voltage/XENTRY findings with guided-test results as they would be recalled on the floor.',
  'Lead the middle section with documented fault codes and measurements, then connect back to the original symptom.',
  'Keep all 10 workflow steps in chronological order, but let the cause conclusion emerge mid-narrative before the repair details.',
] as const;

const TRANSITIONS = [
  'Use varied bridges: "After confirming…", "Next, I…", "With the charger connected…", "Following the guided test…", "Once codes were cleared…".',
  'Prefer plain technician connectors — avoid repeating "Then I" at the start of every sentence.',
  'Link steps with evidence-based transitions that reference what was just found before the next action.',
  'Use minimal transitions; let chronological flow carry the story without formulaic phrase stacking.',
] as const;

const TONE = [
  'Professional shop-floor voice — confident, factual, slightly conversational but never casual slang.',
  'Formal technician report tone — objective, precise, minimal adjectives.',
  'Experienced master-tech voice — matter-of-fact, efficient, sounds dictated between jobs.',
  'Documentation-first tone — neutral, audit-oriented, every claim tied to provided evidence.',
] as const;

function pick<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

/** Random style profile injected into each generation request. */
export function buildStoryStyleVariationBlock(): string {
  return `**Style variation for THIS story (critical — must feel written by a unique technician):**
- Sentence rhythm: ${pick(SENTENCE_RHYTHM)}
- Technical detail emphasis: ${pick(DETAIL_LEVEL)}
- Information order: ${pick(INFORMATION_ORDER)}
- Transitional phrasing: ${pick(TRANSITIONS)}
- Tone: ${pick(TONE)}
- Do NOT reuse opening phrases, transition patterns, or paragraph shapes from other stories. Vary word choice while staying factually identical to the provided data.`;
}

/** Appended to SYSTEM_PROMPT — enhances existing rules without replacing them. */
export const STYLE_VARIATION_SYSTEM_RULES = `## NATURAL STYLE VARIATION (CRITICAL — BENZ BOT EVASION)

Across a dealership, dozens of technicians write warranty stories. **Each output must read like a different person wrote it** while meeting the same audit standard.

Randomly vary (within professional bounds):
- **Sentence structure and rhythm** — mix short and medium sentences; avoid template cadence.
- **Level of technical detail** — emphasize diagnostics, findings, or verification differently per story.
- **Order of information** — keep the 10-step workflow chronological and logical, but vary how cause emerges in the narrative.
- **Transitional phrases** — do not repeat the same connectors (e.g. "Then I", "Next,") across every step.
- **Formality** — shift between matter-of-fact shop-floor voice and slightly more formal documentation tone.

**Hard limits:** Never sacrifice factual accuracy, workflow completeness, or audit safety for variety. Never invent data to sound different. The user message may include a per-story style profile — follow it closely.`;