/**
 * End-to-end audit-correction integration.
 *
 * Converts MI technicianDetails into first-person warranty prose, inserts them at
 * the correct diagnostic-workflow position, and reconciles re-audit results so
 * applied corrections raise the score and stop reappearing as the same gaps.
 */

import type { TechnicianDetailPrompt } from '@/types';
import { appendUniqueDetailText } from '@/lib/storyDetailText';

export type AuditCorrection = {
  missing: string;
  prompt: string;
  field: TechnicianDetailPrompt['field'];
  /** Final first-person sentence(s) to place in the story. */
  prose: string;
};

/** Workflow themes MI re-flags even after wording changes. */
export type AuditGapTheme =
  | 'source_voltage'
  | 'system_scan'
  | 'guided_test'
  | 'clear_codes'
  | 'verification'
  | 'control_unit'
  | 'dtc'
  | 'repair'
  | 'customer_concern';

function normalizeLoose(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Strip coaching imperatives; keep factual content. */
export function stripCoachingImperatives(text: string): string {
  let body = text.trim();
  body = body
    .replace(
      /^(please\s+)?(add|document|include|record|insert|provide|note|mention|list|write|enter|specify|confirm)\s+(the\s+)?/i,
      ''
    )
    .replace(/^(that\s+)?(you\s+)?(should\s+)?/i, '')
    .replace(/^(to\s+the\s+(story|notes|narrative)\s*[:.-]?\s*)/i, '')
    .trim();
  return body;
}

const THEME_PATTERNS: Array<{ theme: AuditGapTheme; re: RegExp }> = [
  {
    theme: 'source_voltage',
    re: /source voltage|battery voltage|voltage (check|reading|at the battery)|b\+|maintainer|charger|koeo voltage/i,
  },
  {
    theme: 'system_scan',
    re: /quick test|system scan|full system scan|connected (xentry|diagnostic|scan)|scan tool|initial scan/i,
  },
  {
    theme: 'guided_test',
    re: /guided test|guided testing|focused diagnostic|fault code testing|cylinder \d|misfire (count|test)/i,
  },
  {
    theme: 'clear_codes',
    re: /clear(ed)? (fault )?codes|final quick test|post-repair scan|codes return/i,
  },
  {
    theme: 'verification',
    re: /verification|final (road|test) drive|road test|miles? (in|out)|mileage (in|out)|confirm(ed)? repair/i,
  },
  {
    theme: 'control_unit',
    re: /control unit|n\d+\/\d+|b\d+\/\d+|y\d+\/\d+|component (id|number)|pin \d/i,
  },
  {
    theme: 'dtc',
    re: /\bdtc\b|fault code|p\d{4}|u\d{4}|b\d{4}|c\d{4}|trouble code/i,
  },
  {
    theme: 'repair',
    re: /\brepair(ed|s)?\b|\breplaced\b|\binstalled\b|r&r|correction performed|parts? (replaced|installed)/i,
  },
  {
    theme: 'customer_concern',
    re: /customer concern|verified the concern|confirm(ed)? the concern|initial evaluation|complaint/i,
  },
];

/** Signals in the story that prove a theme is documented (not just named in a dump). */
const THEME_STORY_COVERAGE: Record<AuditGapTheme, RegExp> = {
  source_voltage:
    /\b(i\s+(checked|measured|verified|recorded|documented)\b[\s\S]{0,80}\b(source|battery)\s+voltage|\bsource voltage\b|\bbattery voltage\b|\b\d{1,2}\.\d{1,2}\s*v\b)/i,
  system_scan:
    /\b(i\s+(connected|performed|ran)\b[\s\S]{0,60}\b(xentry|diagnostic|scan|quick test)|quick test|system scan|full system scan)/i,
  guided_test:
    /\b(i\s+(performed|ran|completed)\b[\s\S]{0,60}\bguided|guided (test|testing|diagnostic)|focused diagnostic)/i,
  clear_codes:
    /\b(i\s+cleared|cleared (fault )?codes|final quick test|post-repair)/i,
  verification:
    /\b(i\s+(completed|performed|verified)\b[\s\S]{0,60}\b(verification|road test|test drive)|final verification|verification (test )?drive|final (road|test) drive)/i,
  control_unit:
    /\b(i\s+(identified|documented|tested)\b[\s\S]{0,60}\b(control unit|component)|n\d+\/\d+|b\d+\/\d+|y\d+\/\d+)/i,
  dtc: /\b(i\s+(documented|found|retrieved|recorded)\b[\s\S]{0,60}\b(fault code|dtc|code)|fault code|p\d{4}|u\d{4}|b\d{4}|c\d{4})/i,
  repair:
    /\b(i\s+(replaced|repaired|installed|performed)\b|repairs performed|correction)/i,
  customer_concern:
    /\b(i\s+(verified|confirmed|road tested)\b[\s\S]{0,80}\b(concern|complaint|noise|misfire|symptom)|verified the concern)/i,
};

export function detectAuditThemes(text: string): AuditGapTheme[] {
  const blob = text || '';
  const found: AuditGapTheme[] = [];
  for (const { theme, re } of THEME_PATTERNS) {
    if (re.test(blob)) found.push(theme);
  }
  return found;
}

export function storyCoversTheme(story: string, theme: AuditGapTheme): boolean {
  return THEME_STORY_COVERAGE[theme].test(story || '');
}

export function storyCoversAnyTheme(story: string, themes: AuditGapTheme[]): boolean {
  return themes.some((t) => storyCoversTheme(story, t));
}

/**
 * Build audit-recognizable first-person prose for a technicianDetail item.
 * Uses field + missing keywords so MI workflow language is explicit.
 */
export function buildAuditRecognizableProse(detail: TechnicianDetailPrompt): string {
  const missing = detail.missing?.trim() || '';
  const rawPrompt = detail.prompt?.trim() || '';
  let fact = stripCoachingImperatives(rawPrompt || missing);
  if (!fact) fact = missing;
  if (!fact) return '';

  // Avoid double-prefix if already first-person
  if (/^i\s+/i.test(fact)) {
    if (!/[.!?]$/.test(fact)) fact = `${fact}.`;
    return fact.charAt(0).toUpperCase() + fact.slice(1);
  }

  fact = fact.charAt(0).toUpperCase() + fact.slice(1);
  if (!/[.!?]$/.test(fact)) fact = `${fact}.`;

  const blob = `${missing} ${rawPrompt} ${fact}`.toLowerCase();
  const themes = detectAuditThemes(blob);

  if (themes.includes('source_voltage')) {
    return `I checked source voltage at the battery and documented the following: ${fact}`;
  }
  if (themes.includes('system_scan')) {
    return `I connected diagnostic equipment and performed the system scan as follows: ${fact}`;
  }
  if (themes.includes('guided_test')) {
    return `I performed guided diagnostic testing and recorded: ${fact}`;
  }
  if (themes.includes('clear_codes')) {
    return `I cleared fault codes and performed post-repair verification scanning: ${fact}`;
  }
  if (themes.includes('verification')) {
    return `I completed verification road testing and documented: ${fact}`;
  }
  if (themes.includes('control_unit')) {
    return `I identified and documented the affected control unit/component: ${fact}`;
  }
  if (themes.includes('dtc')) {
    return `I documented the fault codes and related diagnostic data: ${fact}`;
  }
  if (themes.includes('repair')) {
    return `I performed the repair as follows: ${fact}`;
  }
  if (detail.field === 'diagnostic') {
    return `I documented diagnostic evidence supporting the cause: ${fact}`;
  }
  if (detail.field === 'workflow') {
    return `I completed the following diagnostic workflow step and documented it: ${fact}`;
  }
  if (detail.field === 'customerConcern' || themes.includes('customer_concern')) {
    return `I verified the concern on the initial evaluation as follows: ${fact}`;
  }
  return `I documented the following technician finding in the repair narrative: ${fact}`;
}

export function toAuditCorrection(detail: TechnicianDetailPrompt): AuditCorrection | null {
  const prose = buildAuditRecognizableProse(detail);
  if (!prose) return null;
  return {
    missing: detail.missing?.trim() || '',
    prompt: detail.prompt?.trim() || '',
    field: detail.field,
    prose,
  };
}

/**
 * Themes that define the gap — from missing/prompt only.
 * Do NOT scan generated prose (it injects words like "fault codes" and causes false positives).
 */
export function gapThemesFromDetail(
  detail: Pick<TechnicianDetailPrompt, 'missing' | 'prompt' | 'field'>
): AuditGapTheme[] {
  const fromText = detectAuditThemes(`${detail.missing || ''} ${detail.prompt || ''}`);
  if (fromText.length > 0) return fromText;
  if (detail.field === 'customerConcern') return ['customer_concern'];
  if (detail.field === 'diagnostic') return ['guided_test'];
  if (detail.field === 'workflow') return [];
  return [];
}

/** True if story already contains this correction's distinctive content. */
export function storyHasCorrectionContent(story: string, correction: AuditCorrection): boolean {
  const s = normalizeLoose(story);
  const probes = [correction.prose, correction.missing, correction.prompt]
    .map((x) => normalizeLoose(x || ''))
    .filter((x) => x.length >= 6);

  for (const p of probes) {
    if (s.includes(p)) return true;
    const words = p.split(/[^a-z0-9./-]+/).filter((w) => w.length >= 5).slice(0, 6);
    if (words.length >= 2) {
      const hits = words.filter((w) => s.includes(w)).length;
      if (hits >= Math.ceil(words.length * 0.7)) return true;
    }
  }

  // Theme coverage from the gap description only (not prose wrapper)
  const themes = gapThemesFromDetail(correction);
  if (themes.length > 0 && themes.every((t) => storyCoversTheme(story, t))) {
    return true;
  }
  // Single primary workflow theme is enough when clearly covered
  const primary = themes.find((t) => t !== 'dtc' && t !== 'repair');
  if (primary && storyCoversTheme(story, primary)) {
    return true;
  }

  // Technical tokens
  const tokenRe = /\b(?:[PBCU]\d{4}[A-Z]?|\d{1,2}\.\d{1,2}\s*V|N\d+\/\d+|B\d+\/\d+)\b/gi;
  const tokens = [...(correction.prose + ' ' + correction.prompt).matchAll(tokenRe)].map((m) => m[0]);
  if (tokens.length > 0) {
    const hit = tokens.filter((t) => s.includes(t.toLowerCase())).length;
    if (hit === tokens.length) return true;
  }
  return false;
}

/**
 * True when a newly returned gap is already closed by the story (and optionally
 * by previously applied corrections with the same theme).
 */
export function isGapResolvedInStory(
  story: string,
  detail: Pick<TechnicianDetailPrompt, 'missing' | 'prompt' | 'field'>,
  appliedCorrectionTexts: string[] = []
): boolean {
  const c = toAuditCorrection({
    missing: detail.missing,
    prompt: detail.prompt,
    field: detail.field || 'technicianNotes',
  });
  if (c && storyHasCorrectionContent(story, c)) return true;

  const gapThemes = gapThemesFromDetail({
    missing: detail.missing,
    prompt: detail.prompt,
    field: detail.field || 'technicianNotes',
  });
  if (gapThemes.length === 0) return false;

  // Prefer primary workflow themes over incidental dtc/repair tags
  const primaryThemes = gapThemes.filter((t) => t !== 'dtc' && t !== 'repair');
  const checkThemes = primaryThemes.length > 0 ? primaryThemes : gapThemes;

  if (!checkThemes.some((t) => storyCoversTheme(story, t))) return false;

  // If we have applied corrections, require theme overlap with them (stronger confidence).
  // If no applied list, story coverage alone is enough (post-filter safety).
  if (appliedCorrectionTexts.length === 0) return true;

  const appliedThemes = new Set(appliedCorrectionTexts.flatMap((t) => detectAuditThemes(t)));
  return checkThemes.some((t) => appliedThemes.has(t));
}

type InsertAnchor = { re: RegExp; /** insert before match */ before: boolean };

function anchorsForCorrection(c: AuditCorrection): InsertAnchor[] {
  const blob = `${c.missing} ${c.prompt} ${c.prose}`.toLowerCase();
  const anchors: InsertAnchor[] = [];

  if (/voltage|battery|maintainer|charger/.test(blob)) {
    anchors.push(
      { re: /\b(source voltage|battery voltage|install(ed)? battery|battery (charger|maintainer))\b/i, before: false },
      { re: /\b(connect(ed)? (xentry|diagnostic|scan)|quick test|system scan)\b/i, before: true }
    );
  }
  if (/quick test|system scan|xentry|diagnostic equipment|scan tool/.test(blob)) {
    anchors.push(
      { re: /\b(connect(ed)? (xentry|diagnostic|scan)|quick test|system scan|full system scan)\b/i, before: false },
      { re: /\b(guided test|focused diagnostic|fault codes)\b/i, before: true }
    );
  }
  if (/guided|fault code|dtc|p\d{4}/.test(blob)) {
    anchors.push(
      { re: /\b(guided test|focused diagnostic|fault code)\b/i, before: false },
      { re: /\b(technician findings|findings and|repairs performed|i (replaced|repaired|installed))\b/i, before: true }
    );
  }
  if (/repair|replaced|installed|correction/.test(blob)) {
    anchors.push(
      { re: /\b(repairs performed|i (replaced|repaired|installed)|correction)\b/i, before: false },
      { re: /\b(clear(ed)? (fault )?codes|final quick test|post-repair)\b/i, before: true }
    );
  }
  if (/verification|final (road|test) drive|mileage|miles/.test(blob)) {
    anchors.push({ re: /\b(final verification|verification (test )?drive|final (road|test) drive)\b/i, before: false });
  }

  if (c.field === 'diagnostic') {
    anchors.push(
      { re: /\b(guided test|diagnostic|fault)\b/i, before: false },
      { re: /\b(repairs performed|i replaced)\b/i, before: true }
    );
  }
  if (c.field === 'workflow') {
    anchors.push({ re: /\b(final verification|verification drive|disconnect)\b/i, before: true });
  }

  anchors.push(
    { re: /\b(final verification|verification (test )?drive|final (road|test) drive)\b/i, before: true },
    { re: /\b(disconnect)\b/i, before: true }
  );

  return anchors;
}

/** Back up from a mid-clause match to the start of the current sentence. */
function sentenceStartIndex(story: string, idx: number): number {
  const before = story.slice(0, idx);
  const m = before.match(/[.!?]\s+(?=[A-Z"'])/g);
  if (!m) {
    // Also treat paragraph breaks
    const para = before.lastIndexOf('\n');
    return para >= 0 ? para + 1 : 0;
  }
  let last = 0;
  const re = /[.!?]\s+(?=[A-Z"'])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(before)) !== null) {
    last = match.index + match[0].length;
  }
  return last;
}

function insertSentence(story: string, sentence: string, idx: number, before: boolean): string {
  let at = idx;
  if (before) {
    // Avoid splitting "I connected XENTRY" into "I. <insert> connected XENTRY"
    at = sentenceStartIndex(story, idx);
  } else {
    const after = story.slice(idx);
    const m = after.match(/^[\s\S]{0,160}?[.!?](?:\s|$)/);
    at = idx + (m ? m[0].length : 0);
  }
  const left = story.slice(0, at).trimEnd();
  const right = story.slice(at).trimStart();
  const joiner = !left ? '' : /[.!?]$/.test(left) ? ' ' : '. ';
  return `${left}${joiner}${sentence}${right ? (/[.!?]$/.test(sentence) ? ' ' : '. ') + right : ''}`.replace(
    /  +/g,
    ' '
  );
}

/** Remove a nearly-duplicate trailing dump of the same prose (from earlier append-only apply). */
function stripTrailingDuplicate(story: string, prose: string): string {
  const norm = normalizeLoose(prose);
  if (norm.length < 12) return story;
  const parts = story.split(/(?<=[.!?])\s+/);
  while (parts.length > 1) {
    const last = normalizeLoose(parts[parts.length - 1] || '');
    if (last && (last.includes(norm.slice(0, Math.min(40, norm.length))) || norm.includes(last.slice(0, 40)))) {
      parts.pop();
      continue;
    }
    break;
  }
  return parts.join(' ').trim();
}

/**
 * Integrate one correction into the story at the right workflow place.
 * Always re-weaves (even if a weak trailing dump already exists).
 */
export function weaveCorrectionIntoStory(story: string, correction: AuditCorrection): string {
  let base = story.trim();
  if (!base) return correction.prose;
  if (!correction.prose) return base;

  base = stripTrailingDuplicate(base, correction.prose);
  base = stripTrailingDuplicate(base, correction.prompt);
  base = stripTrailingDuplicate(base, correction.missing);

  const idxExisting = normalizeLoose(base).indexOf(normalizeLoose(correction.prose).slice(0, 48));
  if (idxExisting >= 0 && idxExisting < base.length * 0.85 && storyHasCorrectionContent(base, correction)) {
    if (/\[NOT DOCUMENTED\]/i.test(base) && /voltage|guided|scan|quick test|verification|code/i.test(correction.prose)) {
      return base.replace(/\[NOT DOCUMENTED\]/i, correction.prose.replace(/\.$/, ''));
    }
    return base;
  }

  // Theme already well covered mid-story — avoid dumping again
  if (storyHasCorrectionContent(base, correction)) {
    return base;
  }

  if (/\[NOT DOCUMENTED\]/i.test(base)) {
    const replaced = base.replace(/\[NOT DOCUMENTED\]/i, correction.prose.replace(/\.$/, ''));
    if (replaced !== base) return replaced;
  }

  for (const anchor of anchorsForCorrection(correction)) {
    const m = base.search(anchor.re);
    if (m >= 0) {
      return insertSentence(base, correction.prose, m, anchor.before);
    }
  }

  return appendUniqueDetailText(base, correction.prose);
}

/**
 * Full integration of audit technicianDetails into a warranty story.
 * Used by Add All and by Regenerate (deterministic primary path).
 */
export function integrateTechnicianDetailsIntoStory(
  priorStory: string,
  details: TechnicianDetailPrompt[]
): string {
  const corrections = details.map(toAuditCorrection).filter(Boolean) as AuditCorrection[];
  let result = (priorStory || '').trim();
  if (!result && corrections.length === 0) return '';
  if (!result) return corrections.map((c) => c.prose).join(' ');

  for (const c of corrections) {
    result = weaveCorrectionIntoStory(result, c);
  }
  return result.replace(/  +/g, ' ').trim();
}

/** Build a short list for the scorer: gaps that should now be treated as addressed. */
export function formatAddressedGapsForScorer(details: TechnicianDetailPrompt[]): string {
  if (!details.length) return '';
  return details
    .map((d, i) => {
      const c = toAuditCorrection(d);
      if (!c) return '';
      return `${i + 1}. Was missing: ${c.missing || c.prompt}. Now documented in story as: ${c.prose}`;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Count how many applied corrections are actually reflected in the story text
 * (theme coverage or content match).
 */
export function countAppliedCorrectionsPresentInStory(
  story: string,
  appliedCorrectionTexts: string[]
): number {
  let n = 0;
  for (const text of appliedCorrectionTexts) {
    const themes = detectAuditThemes(text);
    if (themes.length > 0 && storyCoversAnyTheme(story, themes)) {
      n += 1;
      continue;
    }
    const c = toAuditCorrection({
      missing: text.slice(0, 120),
      prompt: text,
      field: 'workflow',
    });
    if (c && storyHasCorrectionContent(story, c)) n += 1;
  }
  return n;
}

/** True if free-text recommendation matches a covered applied theme. */
export function recommendationResolvedByApplied(
  text: string,
  story: string,
  appliedCorrectionTexts: string[]
): boolean {
  const themes = detectAuditThemes(text);
  if (themes.length === 0) return false;
  if (!storyCoversAnyTheme(story, themes)) return false;
  if (appliedCorrectionTexts.length === 0) return true;
  const appliedThemes = new Set(appliedCorrectionTexts.flatMap((t) => detectAuditThemes(t)));
  return themes.some((t) => appliedThemes.has(t));
}
