/**
 * Strict truth enforcement — shared by every story brand pack.
 * Customer Complaint / advisor RO complaints are never story evidence.
 */
export const STRICT_TRUTH_RULES = `STRICT TRUTH RULES (non-negotiable):
- Use ONLY: technician notes/findings, data extracted from diagnostic photos, and structural RO metadata (RO number, line number/description as job label, vehicle year/make/model, mileage when provided).
- Never invent codes, measurements, test results, parts, mileage values, or diagnostic outcomes.
- Use [NOT DOCUMENTED] for any required workflow step that is not supported by technician notes or diagnostic photo data.
- Customer Complaint fields and advisor-written RO complaints are OUT OF SCOPE — they are often inaccurate. They are deliberately withheld from your input. Do not invent a customer concern narrative.
- Line description is a job/line label only — not a substitute for technician-documented findings unless those findings appear in technician notes.
- If technician notes and diagnostic extracts are empty or sparse, write an honest incomplete narrative with [NOT DOCUMENTED] placeholders — never a polished fabricated workflow.
- OUTPUT LANGUAGE: Write the entire warranty narrative in professional English only. Never leave Spanish or other non-English prose in the final story (technical codes, part numbers, and proper nouns stay as written).`;

export const TRUTH_USER_MESSAGE_BANNER = `TRUTH POLICY: Customer Complaint and RO advisor complaints are withheld. Write only from technician notes and diagnostic photo extracts below. Do not invent a concern. Final story must be professional English only.`;

/** Appended to user messages when technician notes may be non-English. */
export function buildInputLanguageInstruction(preferredLanguage?: string | null): string {
  const code = (preferredLanguage || 'en').trim().toLowerCase();
  if (!code || code === 'en') return '';
  // Keep names English (model instructions). Extend as SUPPORTED_LOCALES grow.
  const nameByCode: Record<string, string> = {
    es: 'Spanish',
    pt: 'Portuguese',
    fr: 'French',
    de: 'German',
  };
  const name = nameByCode[code] ?? code;
  return `INPUT LANGUAGE: Technician notes may be written in ${name} (${code}). First understand and translate the technical meaning into clear technical English, then write a high-quality warranty-compliant English story. Preserve fault codes, part numbers, measurements, control-unit IDs, and proper nouns literally — do not invent facts while translating.`;
}
