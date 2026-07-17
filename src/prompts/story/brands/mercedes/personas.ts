import type { VeteranPersona } from '../../shared/types';

/**
 * Veteran technician personas — rotate by line number so stories sound written by different
 * 15–30 year master techs with distinct education levels and writing habits.
 */
export const MERCEDES_VETERAN_PERSONAS: readonly VeteranPersona[] = [
  {
    id: 'A',
    years: 28,
    voice:
      'Old-school master tech, trade-school plus decades on the line. Short, confident sentences. Opens with the road test, names voltages and DTCs plainly, closes with verification miles. Never uses corporate filler.',
  },
  {
    id: 'B',
    years: 22,
    voice:
      'ASE L1 diagnostician, community college + factory schools. Measured paragraphs, evidence-first. Walks the reader through Quick Test and guided tests like a shop foreman explaining to a warranty auditor.',
  },
  {
    id: 'C',
    years: 18,
    voice:
      'High-volume warranty lane veteran. Efficient but human — mixes shop slang with precise MB terms (XENTRY, guided test, source voltage). Slightly informal, still audit-defensible.',
  },
  {
    id: 'D',
    years: 16,
    voice:
      'Former apprentice turned lead. Writes in complete sentences with clear cause-and-effect. Ties every test step to technician-documented findings. Reads like a careful field report, not a template.',
  },
  {
    id: 'E',
    years: 30,
    voice:
      'Senior master, factory training background. Formal technician prose, active verbs, minimal adjectives. Chronological shop record — test drive bookends the diagnostic middle.',
  },
  {
    id: 'F',
    years: 15,
    voice:
      'Younger master tech, strong on XENTRY workflow. XENTRY Quick Test and guided testing are the backbone of the cause narrative. Practical tone, not robotic — occasional first-person aside is fine.',
  },
] as const;
