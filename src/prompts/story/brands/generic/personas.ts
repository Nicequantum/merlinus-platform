import type { VeteranPersona } from '../../shared/types';

/** Brand-neutral veteran personas — no OEM-specific tools or brand names. */
export const GENERIC_VETERAN_PERSONAS: readonly VeteranPersona[] = [
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
      'ASE L1 diagnostician, community college + factory schools. Measured paragraphs, evidence-first. Walks the reader through system scans and focused diagnostic tests like a shop foreman explaining to a warranty auditor.',
  },
  {
    id: 'C',
    years: 18,
    voice:
      'High-volume warranty lane veteran. Efficient but human — mixes shop slang with precise technical terms (system scan, guided diagnostic testing, source voltage). Slightly informal, still audit-defensible.',
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
      'Younger master tech, strong on scan-tool workflow. Initial system scan and focused diagnostic testing are the backbone of the cause narrative. Practical tone, not robotic — occasional first-person aside is fine.',
  },
] as const;
