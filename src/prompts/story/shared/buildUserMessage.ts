import type { RepairLine, RepairOrder } from '@/types';
import { formatExtractedDataForPrompt } from '@/utils/diagnosticParser';
import { extractRequiredCorrectionsFromNotes } from '@/lib/storyRegenerateGuard';
import type { StoryBrandPack, VeteranPersona } from './types';
import { buildInputLanguageInstruction, TRUTH_USER_MESSAGE_BANNER } from './truthRules';
import { PROMPT_FIELD_LIMITS, truncatePromptField } from './fieldLimits';
import {
  PENDING_CORRECTIONS_END,
  PENDING_CORRECTIONS_START,
  STORY_REGENERATE_USER_HEADER,
} from './regenerateRules';

/** Prior story must be long enough to treat as a real first pass (not a stub). */
export const REGENERATE_PRIOR_STORY_MIN_CHARS = 40;

export type BuildStoryUserMessageOptions = {
  /**
   * Force first-pass or revision mode.
   * Default: auto — revision when line.warrantyStory is substantial.
   */
  mode?: 'generate' | 'regenerate' | 'auto';
  /** Override prior story text (defaults to line.warrantyStory). */
  priorStory?: string | null;
  /**
   * Technician preferred language for notes input (`en` | `es` | …).
   * Story output is always professional English.
   */
  preferredLanguage?: string | null;
};

export function selectPersonaFromPack(
  pack: StoryBrandPack,
  lineNumber: number
): VeteranPersona {
  const personas = pack.personas;
  if (!personas.length) {
    return { id: 'A', years: 20, voice: 'Experienced master technician. Clear, evidence-first prose.' };
  }
  const index = Math.abs(lineNumber - 1) % personas.length;
  return personas[index]!;
}

export function shouldRegenerateStory(
  line: Pick<RepairLine, 'warrantyStory'>,
  options?: BuildStoryUserMessageOptions
): boolean {
  if (options?.mode === 'generate') return false;
  if (options?.mode === 'regenerate') return true;
  const prior = (options?.priorStory ?? line.warrantyStory ?? '').trim();
  return prior.length >= REGENERATE_PRIOR_STORY_MIN_CHARS;
}

function formatDiagnosticsBlock(line: RepairLine, pack: StoryBrandPack): string {
  const diagnosticsText = formatExtractedDataForPrompt(
    line.extractedData || {
      codes: [],
      faultCodes: [],
      guidedTests: [],
      measurements: [],
      components: [],
      circuits: [],
    }
  );
  const lineOcr =
    line.xentryOcrTexts && line.xentryOcrTexts.length > 0
      ? truncatePromptField(line.xentryOcrTexts.join(' | '), PROMPT_FIELD_LIMITS.ocr)
      : '';
  return `Diagnostics extracted from ${pack.diagnosticsSourceLabel}: ${diagnosticsText || '[NOT PROVIDED]'}${
    lineOcr ? ` | OCR: ${lineOcr}` : ''
  }`;
}

/**
 * Shared truth-filtered user message builder.
 * First pass: notes + diagnostics.
 * Edit pass: current story as base + required corrections only (conservative).
 */
export function buildStoryUserMessage(
  ro: RepairOrder,
  line: RepairLine,
  pack: StoryBrandPack,
  options?: BuildStoryUserMessageOptions
): string {
  const vehicle = `${ro.vehicle.year} ${ro.vehicle.make} ${ro.vehicle.model}`.replace(/\s+/g, ' ').trim();
  const miles = `${ro.vehicle.mileageIn}${ro.vehicle.mileageOut ? `→${ro.vehicle.mileageOut}` : ''}`;
  const persona = selectPersonaFromPack(pack, line.lineNumber);
  const diagnosticsBlock = formatDiagnosticsBlock(line, pack);

  const notesRaw = line.technicianNotes || '[NOT PROVIDED]';
  const notes = truncatePromptField(notesRaw, PROMPT_FIELD_LIMITS.notes, {
    preferEnd: true,
  });

  const priorStory = (options?.priorStory ?? line.warrantyStory ?? '').trim();
  const isRegen = shouldRegenerateStory(line, { ...options, priorStory });
  const languageBlock = buildInputLanguageInstruction(options?.preferredLanguage);
  const languageSection = languageBlock ? `\n\n${languageBlock}\n` : '\n';

  if (isRegen && priorStory) {
    // Prefer full current story — do not preferEnd (would drop the opening).
    const currentStory = truncatePromptField(priorStory, PROMPT_FIELD_LIMITS.priorStory, {
      preferEnd: false,
    });
    const corrections = extractRequiredCorrectionsFromNotes(notesRaw);
    const correctionsBlock =
      corrections.length > 0
        ? corrections.map((c, i) => `${i + 1}. ${c}`).join('\n')
        : '(No separate correction list — polish CURRENT_STORY only; do not remove technical content.)';

    // Use === fences (not HTML-like <...>) so nothing is mistaken for markup.
    return `Line ${line.lineNumber}: ${line.description}
RO ${ro.roNumber} | ${vehicle} | ${miles} mi

${TRUTH_USER_MESSAGE_BANNER}
${languageSection}
${STORY_REGENERATE_USER_HEADER}

Keep the same technician voice (persona ${persona.id}, ~${persona.years} years):
${persona.voice}

===CURRENT_STORY_TO_EDIT===
${currentStory}
===END_CURRENT_STORY_TO_EDIT===

===REQUIRED_CORRECTIONS===
${truncatePromptField(correctionsBlock, 1_800, { preferEnd: true })}
===END_REQUIRED_CORRECTIONS===

Supporting technician notes (context only — do not drop facts already in the current story):
===TECHNICIAN_NOTES===
${notes}
===END_TECHNICIAN_NOTES===
${diagnosticsBlock}

EDITING INSTRUCTIONS (follow exactly):
1. Treat CURRENT_STORY_TO_EDIT as the base document you are correcting — not a brainstorm seed.
2. Keep every code, measurement, control-unit number, mileage, test name, and part already in that story (including punctuation like dashes/slashes).
3. Apply each REQUIRED_CORRECTION by inserting or fixing the relevant sentence in the correct chronological place. If the story has [NOT DOCUMENTED] for that item, replace the placeholder with the real detail.
4. Do not delete paragraphs or thin the story. Do not invent unsupported facts.
5. Do not leave corrections as a list at the bottom — weave them in.
6. Output the FULL improved story only (complete narrative for Line ${line.lineNumber}).

Pending corrections fence marker (for your awareness): ${PENDING_CORRECTIONS_START} ... ${PENDING_CORRECTIONS_END}`;
  }

  return `Line ${line.lineNumber}: ${line.description}
RO ${ro.roNumber} | ${vehicle} | ${miles} mi

${TRUTH_USER_MESSAGE_BANNER}
${languageSection}
STYLE VARIATION — write as this veteran technician (persona ${persona.id}, ~${persona.years} years experience):
${persona.voice}

Technician notes (expand into professional English prose; never copy verbatim; never invent facts not supported here):
<<<TECHNICIAN_NOTES>>
${notes}
<<<END_TECHNICIAN_NOTES>>
${diagnosticsBlock}

${pack.generateClosingInstruction(line.lineNumber, persona.id)}`;
}

/**
 * Score/review context — same truth filter (no customer complaint / RO complaints as evidence).
 * Workflow list comes from the active brand pack.
 */
export function buildStoryQualityLineContext(
  ro: RepairOrder,
  line: RepairLine,
  pack: StoryBrandPack
): string {
  const diagnosticsText = formatExtractedDataForPrompt(
    line.extractedData || {
      codes: [],
      faultCodes: [],
      guidedTests: [],
      measurements: [],
      components: [],
      circuits: [],
    }
  );
  const workflowList = pack.workflowSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const notes = line.technicianNotes || '[NOT PROVIDED]';

  return `Line ${line.lineNumber}: ${line.description}
Vehicle: ${ro.vehicle.year} ${ro.vehicle.make} ${ro.vehicle.model} | Miles ${ro.vehicle.mileageIn || '?'}/${ro.vehicle.mileageOut || '?'}
${TRUTH_USER_MESSAGE_BANNER}
Technician notes (supporting context — do not invent beyond notes/diagnostics/story):
<<<TECHNICIAN_NOTES>>
${notes}
<<<END_TECHNICIAN_NOTES>>
Diagnostics: ${diagnosticsText || 'None extracted.'}
Workflow steps required: ${workflowList}`;
}
