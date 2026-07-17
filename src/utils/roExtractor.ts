import type { StructuredROExtraction, VehicleInfo } from '../types';

const HEADER_ROW_PATTERN =
  /LINE\s+OP(?:\s*CODE|CODE)?\s+TECH\s+TYPE\s+(?:HOURS|DESCRIPTION\s*\/?\s*INSTRUCTIONS?)/i;
const HEADER_ROW_STRIP_PATTERN =
  /LINE\s+OP(?:\s*CODE|CODE)?\s+TECH\s+TYPE\s+(?:HOURS|DESCRIPTION\s*\/?\s*INSTRUCTIONS?)\s*/i;
const COMPLAINT_SECTION_HEADERS = [
  HEADER_ROW_PATTERN,
  /Customer\s+Complaints?/i,
  /COMPLAINT\s+LINE/i,
];
/** Only used when no hashtag labels or structural headers are present. */
const COMPLAINT_SECTION_FALLBACK_MARKERS = [/CUST(?:OMER)?\s+(?:STATES?|COMPLAINT|CONCERN)/i];

/**
 * Whole-token form-field noise when it is the entire first word of a line.
 * Note: do NOT include bare "service" — that would drop menu lines like
 * "Service Package" / "Service B" that are real RO line items (Customer Pay).
 */
const JUNK_COMPLAINT_PREFIX =
  /^(vin|mile|km|ro\s*#|date|tech|name|model|customer|advisor|authorized|total|tax|parts|shop|dealer|labor|signature|opcode|line|hours|type|passed|cdef|risi)$/i;

/** Continuation / inspection detail lines — not standalone complaints. */
const INSPECTION_DETAIL_LINE =
  /^(?:RISI\b|CDEF\b|PASSED\b|\d{3,}\s*(?:PASSED|CDEF|RISI)\b)/i;

/** Complaint line slots — any single capital letter A through Z. */
const COMPLAINT_SLOT_PATTERN = '[A-Z]';
const COMPLAINT_SLOT_RE = /^[A-Z]$/;

const LETTER_LABEL_PATTERN = /^([A-Z])\s+(.+)$/i;
/** "# A" label only (optional trailing comma is OCR noise, not RO format). */
const HASHTAG_LABEL_ONLY_LINE = new RegExp(`^#\\s*(${COMPLAINT_SLOT_PATTERN})\\b\\s*,?\\s*$`, 'i');
/** "# A complaint text" on one line. */
const HASHTAG_LABEL_WITH_TEXT_LINE = new RegExp(`^#\\s*(${COMPLAINT_SLOT_PATTERN})\\b\\s+(.+)$`, 'i');
const HASHTAG_LETTER_PART_PATTERN = new RegExp(`^#\\s*(${COMPLAINT_SLOT_PATTERN})\\b\\s+(.+)$`, 'i');
const LETTER_LABEL_OUTPUT_PATTERN = new RegExp(
  `^#?\\s*(${COMPLAINT_SLOT_PATTERN})[\\.\\)\\:\\s\\-–—–—]+\\s*(.+)$`,
  'i'
);
/** Split merged OCR only on explicit "# X" boundaries — never inside complaint words. */
const HASHTAG_BOUNDARY_SPLIT = new RegExp(`\\s+(?=#\\s*${COMPLAINT_SLOT_PATTERN}\\b)`, 'i');
const COMPLAINT_SECTION_END =
  /^(?:authorized|customer\s+signature|technician\s+signature|tech\s+signature|total\s+(?:due|charges)|grand\s+total|subtotal|disclaimer|warranty\s+disclaimer)/i;

const PRE_COMPLAINT_FIELD_NOISE =
  /^(?:ro\s*#?|repair\s+order|work\s+order|customer|name|vin|mileage|odometer|year|make|model|service\s+advisor|svc|advisor|writer|phone|date|tag|plate|state|zip|acct|account|mr|mrs|ms|dr)\b/i;

const VMI_INLINE_NOISE =
  /\b(?:vehicle\s+master\s+inquiry|factory\s+warranty|cpo\s+warranty|extended\s+ela|service\s+history\s+summary)\b/gi;

function isComplaintSlotLetter(letter: string): boolean {
  return COMPLAINT_SLOT_RE.test(letter.toUpperCase());
}

export interface LabeledComplaint {
  letter: string;
  text: string;
}

function collectExplicitHashtagLabels(text: string): Set<string> {
  return new Set(collectComplaintSlotLabelsInOrder(text));
}

/** Merge multiple label-order sources into one document-order list. */
function mergeLabelOrder(...sources: string[][]): string[] {
  const order: string[] = [];
  for (const source of sources) {
    for (const raw of source) {
      const letter = raw.toUpperCase();
      if (!isComplaintSlotLetter(letter)) continue;
      if (!order.includes(letter)) order.push(letter);
    }
  }
  return order;
}

function collectHashtagLabelsFromSegment(segment: string, order: string[]) {
  for (const match of segment.matchAll(new RegExp(`#\\s*(${COMPLAINT_SLOT_PATTERN})\\b`, 'gi'))) {
    const letter = match[1].toUpperCase();
    if (isComplaintSlotLetter(letter) && !order.includes(letter)) {
      order.push(letter);
    }
  }
}

/** Document-order # letter labels at line start (# A, #A, # A.) and jammed on header rows. */
export function collectComplaintSlotLabelsInOrder(text: string): string[] {
  const order: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (HEADER_ROW_PATTERN.test(trimmed)) {
      const remainder = trimmed.replace(HEADER_ROW_STRIP_PATTERN, ' ').trim();
      collectHashtagLabelsFromSegment(remainder, order);
      if (!order.includes('A') && extractJammedLineAFromHeaderTail(remainder)) {
        order.unshift('A');
      }
    }

    const labelOnly = trimmed.match(HASHTAG_LABEL_ONLY_LINE);
    const inline = trimmed.match(HASHTAG_LABEL_WITH_TEXT_LINE);
    const tight = trimmed.match(/^#([A-Z])\b\s*(.*)$/i);
    const letter = (labelOnly?.[1] || inline?.[1] || tight?.[1])?.toUpperCase();
    if (letter && isComplaintSlotLetter(letter) && !order.includes(letter)) {
      order.push(letter);
    }
  }
  return order;
}

function ensureComplaintSlotLetters(paired: LabeledComplaint[], text: string): LabeledComplaint[] {
  const slotLabels = mergeLabelOrder(
    collectComplaintSlotLabelsInOrder(text),
    paired.map((item) => item.letter)
  );

  if (slotLabels.length === 0) {
    return paired.filter((item) => isComplaintSlotLetter(item.letter));
  }

  const byLetter = new Map<string, string>();
  for (const { letter, text: value } of paired) {
    if (!isComplaintSlotLetter(letter)) continue;
    const existing = byLetter.get(letter) || '';
    if (!existing || (value && value.length > existing.length)) {
      byLetter.set(letter, value);
    }
  }

  return slotLabels.map((letter) => ({
    letter,
    text: byLetter.get(letter) || '',
  }));
}

/** True OCR garbage only — keep short/QC/placeholder lines for labeled # A–F slots. */
export function isObviousOcrGarbage(text: string): boolean {
  const trimmed = normalizeComplaintText(text);
  if (!trimmed) return false;
  const compact = trimmed.replace(/\s/g, '');

  if (/^[_=+\-/*\\#]/.test(trimmed) && trimmed.length < 24) return true;
  const hasReadableWord = trimmed
    .split(/\s+/)
    .some((word) => word.length >= 3 && /[aeiou]/i.test(word));
  if (/^[A-Z0-9_\-]{10,}$/i.test(compact) && /[\d_\-]/.test(compact) && !hasReadableWord) return true;
  if (/\b[A-HJ-NPR-Z0-9]{11,17}\b/i.test(trimmed) && !/\s/.test(trimmed)) return true;
  if (/^=EA[,;-]/i.test(trimmed)) return true;
  if (/^_[A-Z0-9]/i.test(trimmed)) return true;
  if (/^[A-Z]{5,10}$/.test(trimmed) && !/[AEIOU]/i.test(trimmed)) return true;

  return false;
}

/**
 * Short shop codes / menu-priced packages that are real RO lines but fail the
 * "plausible customer complaint" heuristic (too short / few long words).
 * Includes A/B/C Service and similar Customer Pay menu items.
 */
function isShortServiceLine(text: string): boolean {
  const trimmed = normalizeComplaintText(text);
  if (!trimmed) return false;
  if (trimmed.length <= 4 && /^[A-Z]{2,4}$/.test(trimmed)) return true;
  if (/^(?:QC|QUALITY\s+CONTROL|INSPECTION|STATE\s+INSPECTION)$/i.test(trimmed)) return true;
  // Menu-priced / scheduled services (not warranty-only)
  if (/^[A-C]\s*[-.]?\s*service\b/i.test(trimmed)) return true;
  if (/\b[A-C]\s*[-.]?\s*service\b/i.test(trimmed) && trimmed.length <= 120) return true;
  if (/^(?:oil\s+change|multipoint|multi\s*point|brake\s+fluid|wiper|cabin\s+air|engine\s+air|battery\s+test)\b/i.test(trimmed)) {
    return true;
  }
  if (/^[A-C]\s+svc\b/i.test(trimmed)) return true;
  return false;
}

/**
 * Whether text is a keepable RO line item (warranty concern, menu service, QC, etc.).
 * Used so Customer Pay / B Service lines are not dropped during scan extraction.
 * Still rejects OCR garbage / form junk so stacked-label pairing stays accurate.
 */
export function isAcceptableRoLineText(text: string): boolean {
  const cleaned = normalizeComplaintForDisplay(text);
  if (!cleaned) return false;
  if (isObviousOcrGarbage(cleaned)) return false;
  if (isInspectionDetailLine(cleaned)) return false;
  if (FORM_JUNK_LINE.test(cleaned)) return false;
  if (isShortServiceLine(cleaned)) return true;
  if (isPlausibleComplaintText(cleaned)) return true;
  // Short multi-word menu lines that fail the long-word heuristic (e.g. "B SVC")
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && isValidComplaintText(cleaned) && /[A-Za-z]{3,}/.test(cleaned)) {
    return true;
  }
  return false;
}

/** Junk for stacked # A/# B column pairing — keep QC/short real lines and menu packages. */
function isStackedPairingJunk(text: string): boolean {
  if (!text?.trim()) return true;
  if (isObviousOcrGarbage(text)) return true;
  if (isInspectionDetailLine(text)) return true;
  if (isShortServiceLine(text)) return false;
  if (isAcceptableRoLineText(text)) return false;
  return !isPlausibleComplaintText(text);
}

/** Accept any readable labeled complaint text (loose — technician deletes unwanted lines). */
export function acceptLabeledComplaintText(text: string): string {
  const cleaned = normalizeComplaintForDisplay(text);
  if (!cleaned) return '';
  if (isObviousOcrGarbage(cleaned)) return '';
  if (isInspectionDetailLine(cleaned)) return '';
  if (cleaned.length < 2 || !/[A-Za-z]/.test(cleaned)) return '';
  if (/^\d{3,}\s*(?:CDEF|PASSED|RISI)\b/i.test(cleaned)) return '';
  return cleaned;
}

function letterAppearsAsComplaintLabel(text: string, letter: string): boolean {
  if (!isComplaintSlotLetter(letter)) return false;
  return (
    new RegExp(`#\\s*${letter}\\b`, 'i').test(text) ||
    new RegExp(`(?:^|\\n)\\s*${letter}(?:[\\.\\)\\:\\s\\-–—]+\\S|\\s+\\S)`, 'im').test(text)
  );
}

function parseHashtagComplaintPart(part: string): LabeledComplaint | null {
  const trimmed = part.trim();
  if (!trimmed) return null;

  const match = trimmed.match(HASHTAG_LETTER_PART_PATTERN);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  let text = trimComplaintContinuation(match[2].trim());
  if (!text || new RegExp(`^#\\s*${COMPLAINT_SLOT_PATTERN}\\b`, 'i').test(text)) return null;
  const accepted = acceptLabeledComplaintText(text);
  if (!accepted) return null;
  return { letter, text: accepted };
}

function parseComplaintLabelSegment(segment: string): LabeledComplaint | null {
  const hashtag = parseHashtagComplaintPart(segment);
  if (hashtag) return hashtag;

  const trimmed = segment.trim();
  if (!trimmed) return null;

  const letterMatch = trimmed.match(LETTER_LABEL_PATTERN);
  if (letterMatch) {
    return { letter: letterMatch[1].toUpperCase(), text: letterMatch[2] };
  }

  const outputMatch = trimmed.match(LETTER_LABEL_OUTPUT_PATTERN);
  if (outputMatch) {
    return { letter: outputMatch[1].toUpperCase(), text: outputMatch[2] };
  }

  return null;
}

type ComplaintTimelineEntry =
  | { kind: 'label'; letter: string }
  | { kind: 'text'; text: string };

/** Reject VIN fragments, form codes, and OCR noise misread as complaints. */
export function isPlausibleComplaintText(text: string): boolean {
  if (!isValidComplaintText(text)) return false;
  const trimmed = normalizeComplaintText(text);
  const compact = trimmed.replace(/\s/g, '');

  if (/^[_=+\-/*\\]/.test(trimmed)) return false;
  if (/^#/.test(trimmed)) return false;
  if (/[=,].*[=,]/.test(trimmed) || (/[=,]/.test(trimmed) && !/\s{2,}/.test(trimmed) && trimmed.length < 20)) {
    return false;
  }
  const hasReadableWord = trimmed
    .split(/\s+/)
    .some((word) => word.length >= 3 && /[aeiou]/i.test(word));
  if (/^[A-Z0-9_\-]{10,}$/i.test(compact) && /[\d_\-]/.test(compact) && !hasReadableWord) return false;
  if (/\b[A-HJ-NPR-Z0-9]{11,17}\b/i.test(trimmed) && !/\s/.test(trimmed)) return false;
  if (/\d{5,}/.test(trimmed) && trimmed.split(/\s+/).length < 3) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1 && trimmed.length < 8) return false;
  if (!words.some((word) => /[A-Za-z]{4,}/.test(word))) return false;
  if (words.length >= 3 && !words.some((word) => word.length >= 7)) {
    const avgLen = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    if (avgLen < 4) return false;
  }

  return true;
}

function isHashtagLabelOnlyLine(line: string): string | null {
  const match = line.match(HASHTAG_LABEL_ONLY_LINE);
  return match ? match[1].toUpperCase() : null;
}

function letterBefore(letter: string): string | null {
  const code = letter.toUpperCase().charCodeAt(0);
  if (code <= 65) return null;
  return String.fromCharCode(code - 1);
}

function chunkHasComplaintHeader(text: string): boolean {
  return COMPLAINT_SECTION_HEADERS.some((marker) => marker.test(text));
}

/** Strip header/VIN/VMI tokens OCR merged into jammed Line A text. */
function sanitizeJammedLineAText(text: string): string {
  let cleaned = normalizeComplaintForDisplay(text.replace(VMI_INLINE_NOISE, ' '));
  if (!cleaned) return '';

  cleaned = cleaned.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, ' ').replace(/\bRO\s*#?\s*[A-Z0-9\-]{3,12}\b/gi, ' ');
  cleaned = cleaned.replace(/\b\d{4,7}\s*(?:mi|miles|km)?\b/gi, ' ');

  const words = cleaned.split(/\s+/).filter(Boolean);
  while (words.length > 0 && PRE_COMPLAINT_FIELD_NOISE.test(words[0])) {
    words.shift();
  }

  const filtered = words.filter(
    (word) =>
      word.length >= 2 &&
      /[A-Za-z]/.test(word) &&
      !/^[_=+\-*\\#@$%^&]+$/.test(word) &&
      !/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(word)
  );

  const rebuilt = filtered.join(' ').trim();
  return acceptLabeledComplaintText(rebuilt) || '';
}

/** Parse complaint text jammed directly against the LINE OP CODE header (often missing # A). */
function extractJammedLineAFromHeaderTail(remainder: string): string {
  const trimmed = remainder.trim();
  if (!trimmed) return '';

  const hashInline = trimmed.match(/^#\s*A\b\s+(.+)$/i);
  if (hashInline) {
    const textOnly = hashInline[1]
      .split(new RegExp(`\\s+#\\s*${COMPLAINT_SLOT_PATTERN}\\b`, 'i'))[0]
      .trim();
    return sanitizeJammedLineAText(textOnly);
  }

  const beforeNextLabel = trimmed.split(
    new RegExp(`\\s+#\\s*(?!A\\b)(${COMPLAINT_SLOT_PATTERN})\\b`, 'i')
  )[0];
  const segment = (beforeNextLabel || trimmed).trim();

  const letterInline = segment.match(/^A(?:[\\.\\)\\:\\s\\-–—]+|\s+)(.+)$/i);
  if (letterInline) {
    return sanitizeJammedLineAText(trimComplaintContinuation(letterInline[1]));
  }

  if (!new RegExp(`^#\\s*${COMPLAINT_SLOT_PATTERN}\\b`, 'i').test(segment)) {
    const raw = sanitizeJammedLineAText(segment.replace(/^#\s*A\b\s*/i, ''));
    if (raw) return raw;
  }

  return '';
}

function recoverLineAFromHeaderText(text: string): string {
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const headerMatch = line.match(HEADER_ROW_PATTERN);
    if (!headerMatch || headerMatch.index === undefined) continue;
    const remainder = line.slice(headerMatch.index + headerMatch[0].length).trim();
    const jammed = extractJammedLineAFromHeaderTail(remainder);
    if (jammed) return jammed;
  }
  return '';
}

function recoverMissingLineA(paired: LabeledComplaint[], rawText: string): LabeledComplaint[] {
  const byLetter = new Map<string, string>();
  for (const { letter, text: value } of paired) {
    if (!isComplaintSlotLetter(letter)) continue;
    const existing = byLetter.get(letter) || '';
    if (!existing || (value && value.length > existing.length)) {
      byLetter.set(letter, value);
    }
  }

  const currentA = normalizeComplaintForDisplay(byLetter.get('A') || '');
  let needsA =
    !currentA ||
    (!isPlausibleComplaintText(currentA) && !isShortServiceLine(currentA));

  if (currentA) {
    for (const [letter, value] of byLetter) {
      if (letter === 'A' || !value) continue;
      if (normalizeComplaintForDisplay(value).toLowerCase() === currentA.toLowerCase()) {
        needsA = true;
        byLetter.set('A', '');
        break;
      }
    }
  }

  if (needsA) {
    const fromHeader = recoverLineAFromHeaderText(rawText);
    if (fromHeader) byLetter.set('A', fromHeader);
  }

  const section = getComplaintSection(rawText.replace(/\r\n/g, '\n'));
  const timeline = buildComplaintTimeline(preprocessComplaintSectionLines(section));
  const firstLabelIdx = timeline.findIndex((entry) => entry.kind === 'label');
  if (firstLabelIdx > 0 && needsA && !byLetter.get('A') && chunkHasComplaintHeader(rawText)) {
    const firstLetter = (timeline[firstLabelIdx] as Extract<ComplaintTimelineEntry, { kind: 'label' }>)
      .letter;
    if (firstLetter !== 'A') {
      const orphan = timeline
        .slice(0, firstLabelIdx)
        .filter((entry) => entry.kind === 'text')
        .map((entry) => (entry as Extract<ComplaintTimelineEntry, { kind: 'text' }>).text)
        .join(' ');
      const recovered = sanitizeJammedLineAText(orphan);
      if (recovered) byLetter.set('A', recovered);
    }
  }

  if (byLetter.size === 0) return paired;

  const order = mergeLabelOrder(
    collectComplaintSlotLabelsInOrder(rawText),
    paired.map((item) => item.letter),
    [...byLetter.keys()]
  );

  if (byLetter.get('A') && order.includes('A') && order[0] !== 'A') {
    return ['A', ...order.filter((letter) => letter !== 'A')].map((letter) => ({
      letter,
      text: byLetter.get(letter) || '',
    }));
  }

  return order.map((letter) => ({
    letter,
    text: byLetter.get(letter) || '',
  }));
}

/** Do not assign identical advisor text to multiple letter slots (e.g. duplicate # B copied onto A). */
function resolveDuplicateComplaintTexts(
  labels: string[],
  complaints: string[],
  grokMap: Map<string, string>,
  ocrText: string
): string[] {
  const resolved = complaints.map((raw) => normalizeComplaintForDisplay(raw));
  const ocrLabelOrder = collectComplaintSlotLabelsInOrder(ocrText);

  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const left = resolved[i];
      const right = resolved[j];
      if (!left || !right || left.toLowerCase() !== right.toLowerCase()) continue;

      const letterI = labels[i].toUpperCase();
      const letterJ = labels[j].toUpperCase();
      const countI = ocrLabelOrder.filter((letter) => letter === letterI).length;
      const countJ = ocrLabelOrder.filter((letter) => letter === letterJ).length;

      if (letterI === 'A' && letterJ !== 'A') {
        const grokA = normalizeComplaintForDisplay(grokMap.get('A') || '');
        const headerA = recoverLineAFromHeaderText(ocrText);
        if (grokA && grokA.toLowerCase() !== left.toLowerCase()) {
          resolved[i] = grokA;
        } else if (headerA && headerA.toLowerCase() !== left.toLowerCase()) {
          resolved[i] = headerA;
        } else {
          resolved[i] = '';
        }
        continue;
      }

      if (letterJ === 'A' && letterI !== 'A') {
        const grokA = normalizeComplaintForDisplay(grokMap.get('A') || '');
        const headerA = recoverLineAFromHeaderText(ocrText);
        if (grokA && grokA.toLowerCase() !== right.toLowerCase()) {
          resolved[j] = grokA;
        } else if (headerA && headerA.toLowerCase() !== right.toLowerCase()) {
          resolved[j] = headerA;
        } else {
          resolved[j] = '';
        }
        continue;
      }

      if (countJ > countI) {
        resolved[i] = '';
      } else if (countI > countJ) {
        resolved[j] = '';
      } else {
        resolved[j] = '';
      }
    }
  }

  return resolved;
}

/** Advisor duplicated the same complaint — keep first slot only, drop later identical slots. */
function collapseDuplicateAdvisorSlots(paired: LabeledComplaint[]): LabeledComplaint[] {
  const seenTexts = new Set<string>();
  const collapsed: LabeledComplaint[] = [];

  for (const item of paired) {
    const normalized = normalizeComplaintForDisplay(item.text);
    if (!normalized) {
      collapsed.push(item);
      continue;
    }
    const key = normalized.toLowerCase();
    if (seenTexts.has(key)) continue;
    seenTexts.add(key);
    collapsed.push({ letter: item.letter, text: normalized });
  }

  return collapsed;
}

function preprocessComplaintSectionLines(section: string): string[] {
  const lines = section
    .replace(PAGE_MARKER_PATTERN, '\n')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];

  for (let line of lines) {
    if (HEADER_ROW_PATTERN.test(line) && line.replace(HEADER_ROW_STRIP_PATTERN, '').trim().length < 4) {
      continue;
    }
    if (HEADER_ROW_PATTERN.test(line)) {
      const headerMatch = line.match(HEADER_ROW_PATTERN);
      const remainder =
        headerMatch && headerMatch.index !== undefined
          ? line.slice(headerMatch.index + headerMatch[0].length).trim()
          : line.replace(HEADER_ROW_STRIP_PATTERN, ' ').trim();
      if (!remainder) continue;
      const jammedA = extractJammedLineAFromHeaderTail(remainder);
      if (jammedA) {
        out.push('# A', jammedA);
      }
      line = remainder
        .replace(/^#\s*A\b\s*/i, '')
        .replace(/^A(?:[\\.\\)\\:\\s\\-–—]+|\s+)/i, '')
        .replace(
          jammedA ? new RegExp(`^${jammedA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i') : /^$/,
          ''
        )
        .trim();
      if (!line) continue;
      if (!new RegExp(`#\\s*${COMPLAINT_SLOT_PATTERN}\\b`, 'i').test(line)) {
        continue;
      }
    }
    if ((line.match(new RegExp(`#\\s*${COMPLAINT_SLOT_PATTERN}\\b`, 'gi')) || []).length > 1) {
      out.push(...line.split(HASHTAG_BOUNDARY_SPLIT).map((part) => part.trim()).filter(Boolean));
      continue;
    }
    out.push(line);
  }

  return out;
}

function buildComplaintTimeline(lines: string[]): ComplaintTimelineEntry[] {
  const timeline: ComplaintTimelineEntry[] = [];

  for (const line of lines) {
    const tight = line.trim().match(/^#([A-Z])\b\s*(.*)$/i);
    if (tight && isComplaintSlotLetter(tight[1].toUpperCase())) {
      timeline.push({ kind: 'label', letter: tight[1].toUpperCase() });
      const text = trimComplaintContinuation((tight[2] || '').trim());
      if (text) timeline.push({ kind: 'text', text });
      continue;
    }

    const labelOnly = isHashtagLabelOnlyLine(line);
    if (labelOnly) {
      timeline.push({ kind: 'label', letter: labelOnly });
      continue;
    }

    const inline = line.match(HASHTAG_LABEL_WITH_TEXT_LINE);
    if (inline) {
      timeline.push({ kind: 'label', letter: inline[1].toUpperCase() });
      const text = trimComplaintContinuation(inline[2].trim());
      if (text) timeline.push({ kind: 'text', text });
      continue;
    }

    if (isInspectionDetailLine(line)) continue;
    if (FORM_JUNK_LINE.test(line)) continue;
    const content = normalizeComplaintContent(line);
    if (isValidComplaintText(content) || isShortServiceLine(content) || isAcceptableRoLineText(content)) {
      timeline.push({ kind: 'text', text: content });
    }
  }

  return timeline;
}

function isPlausiblePageContinuation(orphan: string): boolean {
  const cleaned = normalizeComplaintForDisplay(orphan);
  if (!cleaned || cleaned.length < 4) return false;
  if (FORM_JUNK_LINE.test(cleaned)) return false;
  if (isInspectionDetailLine(cleaned)) return false;
  if (isObviousOcrGarbage(cleaned)) return false;
  if (/^(?:vin|mileage|customer\s+name|service\s+advisor|authorized|total|model|year)\b/i.test(cleaned)) {
    return false;
  }
  // Long standalone lines are usually other RO fields — not continuations.
  if (cleaned.length > 80 && isPlausibleComplaintText(cleaned)) return false;
  return cleaned.length <= 80 || !isPlausibleComplaintText(cleaned);
}

function appendContinuationText(results: LabeledComplaint[], continuation: string) {
  const extra = normalizeComplaintForDisplay(continuation);
  if (!extra || results.length === 0) return;
  const last = results[results.length - 1];
  const merged = normalizeComplaintForDisplay(`${last.text} ${extra}`.trim());
  if (merged && isAcceptableRoLineText(merged)) {
    last.text = merged;
  }
}

function pickPairedComplaintText(raw: string): string {
  const cleaned = normalizeComplaintForDisplay(raw);
  if (!cleaned) return '';
  if (isAcceptableRoLineText(cleaned)) return cleaned;
  return '';
}

/**
 * Pair labels with complaint text for dealership column layout.
 * Uses strict plausible-text filtering (da16e88) with controlled page-2 continuations.
 */
function pairComplaintTimeline(
  timeline: ComplaintTimelineEntry[],
  options: { recoverOrphanAsLineA?: boolean } = {}
): LabeledComplaint[] {
  const recoverOrphanAsLineA = options.recoverOrphanAsLineA ?? true;
  const results: LabeledComplaint[] = [];
  let index = 0;

  while (index < timeline.length) {
    if (timeline[index].kind === 'text') {
      const orphan = (timeline[index] as Extract<ComplaintTimelineEntry, { kind: 'text' }>).text;
      if (recoverOrphanAsLineA && results.length === 0) {
        let scan = index + 1;
        while (scan < timeline.length && timeline[scan].kind === 'text') scan++;
        if (scan < timeline.length && timeline[scan].kind === 'label') {
          const firstLetter = (
            timeline[scan] as Extract<ComplaintTimelineEntry, { kind: 'label' }>
          ).letter;
          if (firstLetter !== 'A') {
            const recovered = sanitizeJammedLineAText(orphan);
            if (recovered) {
              results.push({ letter: 'A', text: recovered });
              index++;
              continue;
            }
          }
        }
      }
      if (isPlausiblePageContinuation(orphan)) {
        appendContinuationText(results, orphan);
      }
      index++;
      continue;
    }

    if (timeline[index].kind !== 'label') {
      index++;
      continue;
    }

    const labels: string[] = [];
    while (index < timeline.length && timeline[index].kind === 'label') {
      const letter = (timeline[index] as Extract<ComplaintTimelineEntry, { kind: 'label' }>).letter;
      if (isComplaintSlotLetter(letter)) labels.push(letter);
      index++;
    }
    if (labels.length === 0) continue;

    const texts: string[] = [];
    while (index < timeline.length && timeline[index].kind === 'text') {
      texts.push((timeline[index] as Extract<ComplaintTimelineEntry, { kind: 'text' }>).text);
      index++;
    }

    const plausibleTexts = texts.map((value) => pickPairedComplaintText(value)).filter(Boolean);
    const stackedTexts = texts
      .map((value) => pickPairedComplaintText(value))
      .filter((value) => value && !isStackedPairingJunk(value));

    if (labels.length === 1) {
      const joined = normalizeComplaintForDisplay(plausibleTexts.join(' '));
      results.push({ letter: labels[0], text: joined });
    } else {
      labels.forEach((letter, idx) => {
        const text = stackedTexts[idx] || plausibleTexts[idx] || '';
        results.push({ letter, text });
      });
    }
  }

  return results;
}

function mergeOrderedComplaintPages(pages: LabeledComplaint[][]): LabeledComplaint[] {
  const byLetter = new Map<string, string>();
  const order: string[] = [];

  for (const page of pages) {
    for (const { letter, text: value } of page) {
      if (!isComplaintSlotLetter(letter)) continue;
      if (!order.includes(letter)) order.push(letter);
      const existing = byLetter.get(letter) || '';
      const normalized = normalizeComplaintForDisplay(value);
      if (normalized && (!existing || normalized.length > existing.length)) {
        byLetter.set(letter, normalized);
      }
    }
  }

  return order.map((letter) => ({ letter, text: byLetter.get(letter) || '' }));
}

/** Ordered hashtag complaints from OCR — preserves document order (not alphabetical). */
export function extractOrderedHashtagComplaints(text: string): LabeledComplaint[] {
  if (!text?.trim()) return [];

  const normalized = text.replace(/\r\n/g, '\n');
  const pageChunks = normalized.split(PAGE_MARKER_PATTERN).map((chunk) => chunk.trim()).filter(Boolean);

  let paired: LabeledComplaint[];
  if (pageChunks.length > 1) {
    const perPage: LabeledComplaint[][] = [];
    for (let i = 0; i < pageChunks.length; i++) {
      const chunk = pageChunks[i];
      const section = getComplaintSection(chunk);
      const lines = preprocessComplaintSectionLines(section);
      const timeline = buildComplaintTimeline(lines);

      let leadingOrphan = '';
      let firstLabelOnPage: string | null = null;
      const firstLabelIdx = timeline.findIndex((entry) => entry.kind === 'label');
      if (firstLabelIdx > 0) {
        leadingOrphan = timeline
          .slice(0, firstLabelIdx)
          .filter((entry) => entry.kind === 'text')
          .map((entry) => (entry as Extract<ComplaintTimelineEntry, { kind: 'text' }>).text)
          .join(' ');
      }
      if (firstLabelIdx >= 0) {
        firstLabelOnPage = (
          timeline[firstLabelIdx] as Extract<ComplaintTimelineEntry, { kind: 'label' }>
        ).letter;
      }

      const pagePaired = pairComplaintTimeline(timeline, {
        recoverOrphanAsLineA: chunkHasComplaintHeader(chunk) && i === 0,
      });

      if (
        i > 0 &&
        leadingOrphan &&
        isPlausiblePageContinuation(leadingOrphan) &&
        perPage.length > 0
      ) {
        const prevPage = perPage[perPage.length - 1];
        const priorLetter = firstLabelOnPage ? letterBefore(firstLabelOnPage) : null;
        const target =
          (priorLetter && prevPage.find((item) => item.letter === priorLetter)) ||
          prevPage[prevPage.length - 1];
        if (target) {
          const merged = normalizeComplaintForDisplay(`${target.text} ${leadingOrphan}`.trim());
          if (merged && isAcceptableRoLineText(merged)) {
            target.text = merged;
          }
        }
      }

      perPage.push(pagePaired);
    }
    paired = mergeOrderedComplaintPages(perPage);
  } else {
    const section = getComplaintSection(normalized.replace(PAGE_MARKER_PATTERN, '\n'));
    const lines = preprocessComplaintSectionLines(section);
    paired = pairComplaintTimeline(buildComplaintTimeline(lines));
  }

  paired = recoverMissingLineA(paired, normalized);
  const { complaints, labels } = labeledComplaintsToArrays(paired);
  const deduped = resolveDuplicateComplaintTexts(labels, complaints, new Map(), normalized);
  paired = labels.map((letter, idx) => ({ letter, text: deduped[idx] || '' }));
  paired = collapseDuplicateAdvisorSlots(paired);
  return ensureComplaintSlotLetters(paired, normalized);
}

function extractHashtagLabeledBlocks(section: string): Map<string, string> {
  const byLetter = new Map<string, string>();
  for (const { letter, text } of extractOrderedHashtagComplaints(section)) {
    if (text && isAcceptableRoLineText(text)) {
      addLetterComplaint(byLetter, letter, text);
    } else if (!byLetter.has(letter)) {
      // Preserve the letter slot even when text is empty/unparsed — tech can edit
      byLetter.set(letter, text && acceptLabeledComplaintText(text) ? acceptLabeledComplaintText(text) : '');
    }
  }
  return byLetter;
}

function extractPlainLineStartComplaints(section: string): Map<string, string> {
  const byLetter = new Map<string, string>();
  const lines = section.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (new RegExp(`^#\\s*${COMPLAINT_SLOT_PATTERN}\\b`, 'i').test(line)) continue;

    if (HEADER_ROW_PATTERN.test(line)) {
      const afterHeader = line.replace(HEADER_ROW_STRIP_PATTERN, ' ').trim();
      const parsed = parseComplaintLabelSegment(afterHeader);
      if (parsed && !afterHeader.startsWith('#')) addLetterComplaint(byLetter, parsed.letter, parsed.text);
      continue;
    }

    const parsed = parseComplaintLabelSegment(line);
    if (parsed && !line.startsWith('#')) addLetterComplaint(byLetter, parsed.letter, parsed.text);
  }

  return byLetter;
}

const PAGE_MARKER_PATTERN = /===?\s*PAGE\s+\d+\s*===?/gi;
const CUSTOMER_STATES_PREFIX =
  /^(?:c\s*\/\s*s|cust(?:omer)?\s+states?(?:\s+that)?)\s*[:\.\-–—]*\s*/i;
const FORM_JUNK_LINE =
  /^(?:vin|mileage|odometer|authorized|signature|print\s+name|phone|total|parts|labor|tax|shop|dealer|ro\s*#|date|model\s+year|===?\s*PAGE)/i;

function normalizeComplaintText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripPageMarkers(text: string): string {
  return text.replace(PAGE_MARKER_PATTERN, '\n').replace(/\s+/g, ' ').trim();
}

function normalizeMixedCaseWord(word: string, preferAllCaps: boolean): string {
  if (word.length < 3) return word;
  if (preferAllCaps && /[a-z]/.test(word)) return word.toUpperCase();

  const hasUpper = /[A-Z]/.test(word);
  const hasLower = /[a-z]/.test(word);
  if (!hasUpper || !hasLower) return word;
  if (preferAllCaps) return word.toUpperCase();

  const letters = word.replace(/[^A-Za-z]/g, '');
  const upperCount = (letters.match(/[A-Z]/g) || []).length;
  const lowerCount = (letters.match(/[a-z]/g) || []).length;
  if (upperCount >= lowerCount) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function preferAllCapsComplaintStyle(words: string[]): boolean {
  const styled = words.filter((w) => w.length >= 3 && /[A-Za-z]/.test(w));
  if (styled.length === 0) return false;
  const allCapsWords = styled.filter((w) => w === w.toUpperCase() && /[A-Z]/.test(w)).length;
  return allCapsWords / styled.length >= 0.5;
}

function dedupeRepeatedPhrases(text: string): string {
  let result = text;
  result = result.replace(/(customer\s+states(?:\s+that)?[\s.:;-]+)/gi, (_match, _grp, offset) =>
    offset === 0 ? '' : ' '
  );
  result = normalizeComplaintText(result);

  const words = result.split(/\s+/);
  if (words.length >= 6) {
    for (let size = Math.floor(words.length / 2); size >= 3; size--) {
      const first = words.slice(0, size).join(' ');
      const second = words.slice(size, size * 2).join(' ');
      if (first.toLowerCase() === second.toLowerCase()) {
        return words.slice(0, size).join(' ');
      }
    }
  }

  const compact = result.replace(/\s+/g, ' ').trim();
  const mid = Math.floor(compact.length / 2);
  if (mid > 12) {
    const firstHalf = compact.slice(0, mid).trim();
    const secondHalf = compact.slice(mid).trim();
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) return firstHalf;
  }

  return result;
}

/** Clean OCR noise: boilerplate, ellipsis, mixed case, duplicate phrases. */
export function normalizeComplaintForDisplay(text: string): string {
  if (!text?.trim()) return '';

  let cleaned = stripPageMarkers(text);
  cleaned = cleaned.replace(CUSTOMER_STATES_PREFIX, '');
  cleaned = cleaned.replace(/\.{2,}/g, ' ');
  cleaned = cleaned.replace(/[,;:!?]{2,}/g, ' ');
  cleaned = cleaned.replace(/\s+([,.;:])\s*/g, '$1 ');
  cleaned = dedupeRepeatedPhrases(cleaned);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const preferAllCaps = preferAllCapsComplaintStyle(words);
  cleaned = words.map((word) => normalizeMixedCaseWord(word, preferAllCaps)).join(' ');
  cleaned = normalizeComplaintText(cleaned.replace(/^[\s.:;,\-–—]+|[\s.:;,\-–—]+$/g, ''));
  return cleaned;
}

function complaintQualityScore(text: string): number {
  const trimmed = normalizeComplaintText(text);
  if (!trimmed) return 0;
  let score = Math.min(trimmed.length, 120);
  const words = trimmed.split(/\s+/);
  if (words.some((w) => w.length >= 7)) score += 12;
  if (/[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed) && words.length >= 3) score -= 8;
  if (/\.{2,}|_{2,}|={2,}/.test(trimmed)) score -= 10;
  if (/^(customer\s+states|cust\s+states)/i.test(trimmed)) score -= 6;
  if (!isPlausibleComplaintText(trimmed)) score -= 40;
  return score;
}

function pickBestComplaintCandidate(ocrText: string, grokText: string): string {
  const ocr = normalizeComplaintForDisplay(ocrText);
  const grok = normalizeComplaintForDisplay(grokText);
  const ocrOk = ocr && isPlausibleComplaintText(ocr);
  const grokOk = grok && isPlausibleComplaintText(grok);
  if (ocrOk && grokOk) {
    return complaintQualityScore(ocr) >= complaintQualityScore(grok) ? ocr : grok;
  }
  if (grokOk) return grok;
  if (ocrOk) return ocr;
  return acceptLabeledComplaintText(grokText) || acceptLabeledComplaintText(ocrText) || '';
}

function normalizeComplaintContent(text: string): string {
  return normalizeComplaintForDisplay(text.replace(/^RISI\s+/i, ''));
}

function isInspectionDetailLine(text: string): boolean {
  const trimmed = normalizeComplaintText(text);
  return INSPECTION_DETAIL_LINE.test(trimmed);
}

function filterComplaintList(complaints: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of complaints) {
    const c = normalizeComplaintContent(raw);
    // Keep all real RO line items (warranty concerns + menu/Customer Pay packages)
    if (!isAcceptableRoLineText(c) && !isValidComplaintText(c)) continue;
    if (isInspectionDetailLine(c)) continue;
    const key = c.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out.slice(0, 15);
}

/** Strip inspection detail continuations (RISI, CDEF, PASSED) merged onto one OCR line. */
function trimComplaintContinuation(text: string): string {
  const normalized = normalizeComplaintText(text);
  const [head] = normalized.split(/\s+(?=RISI\b|\d{3,}\s+CDEF\b|\d+\s+PASSED\b)/i);
  return normalizeComplaintText(head || normalized);
}

function isValidComplaintText(text: string): boolean {
  const trimmed = normalizeComplaintText(text);
  if (trimmed.length < 4) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  if (/^\d{3,}/.test(trimmed)) return false;
  if (/^complaints?:?$/i.test(trimmed)) return false;
  if (/^customer\s+complaints?:?$/i.test(trimmed)) return false;
  if (JUNK_COMPLAINT_PREFIX.test(trimmed.split(/\s+/)[0] || '')) return false;
  if (JUNK_COMPLAINT_PREFIX.test(trimmed)) return false;
  return true;
}

function isComplaintLetter(letter: string, text: string): boolean {
  if (!isComplaintSlotLetter(letter)) return false;
  if (!text?.trim()) return true;
  const cleaned = normalizeComplaintForDisplay(text);
  return isAcceptableRoLineText(cleaned);
}

function getComplaintSection(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const hasHashtagLabels = new RegExp(`#\\s*${COMPLAINT_SLOT_PATTERN}\\b`, 'i').test(text);
  const markers = hasHashtagLabels
    ? COMPLAINT_SECTION_HEADERS
    : [...COMPLAINT_SECTION_HEADERS, ...COMPLAINT_SECTION_FALLBACK_MARKERS];

  let bestIndex = -1;
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    for (const marker of markers) {
      if (!marker.test(trimmed)) continue;
      if (bestIndex < 0 || offset < bestIndex) bestIndex = offset;
      break;
    }
    offset += line.length + 1;
  }

  let section = bestIndex >= 0 ? text.slice(bestIndex) : text;
  const sectionLines = section.split('\n');
  let endIndex = sectionLines.length;
  for (let i = 1; i < sectionLines.length; i++) {
    if (COMPLAINT_SECTION_END.test(sectionLines[i].trim())) {
      endIndex = i;
      break;
    }
  }
  return sectionLines.slice(0, endIndex).join('\n');
}

function addLetterComplaint(byLetter: Map<string, string>, letter: string, text: string) {
  if (!isComplaintSlotLetter(letter)) return;
  const normalized = pickPairedComplaintText(trimComplaintContinuation(text));
  if (!normalized) return;
  const existing = byLetter.get(letter);
  if (!existing || normalized.length > existing.length) {
    byLetter.set(letter, normalized);
  }
}

/** Build letter → complaint map from OCR/RO text (supports vertical "# A" / "# B" column). */
export function extractLetterLabeledComplaintMap(text: string): Map<string, string> {
  const byLetter = new Map<string, string>();
  if (!text || text.trim().length < 4) return byLetter;

  const section = getComplaintSection(text.replace(/\r\n/g, '\n'));
  const explicitHashtagLabels = collectExplicitHashtagLabels(text);

  for (const [letter, value] of extractHashtagLabeledBlocks(section)) {
    addLetterComplaint(byLetter, letter, value);
  }

  if (explicitHashtagLabels.size === 0) {
    for (const [letter, value] of extractPlainLineStartComplaints(section)) {
      addLetterComplaint(byLetter, letter, value);
    }
  }

  return byLetter;
}

/** Primary extractor for real-world RO complaint lines: "A RHODE ISLAND STATE INSPECTION" / "# A ..." */
export function extractLetterLabeledComplaints(text: string): string[] {
  const byLetter = extractLetterLabeledComplaintMap(text);
  return labeledComplaintsInDocumentOrder(text, byLetter).map((item) => item.text);
}

export function extractLetterLabeledComplaintsWithLabels(text: string): LabeledComplaint[] {
  const byLetter = extractLetterLabeledComplaintMap(text);
  return labeledComplaintsInDocumentOrder(text, byLetter);
}

function sortedLabeledComplaints(byLetter: Map<string, string>): LabeledComplaint[] {
  return [...byLetter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, text]) => ({ letter, text }));
}

function labeledComplaintsInDocumentOrder(text: string, byLetter: Map<string, string>): LabeledComplaint[] {
  const ordered = extractOrderedHashtagComplaints(text);
  if (ordered.length === 0) return sortedLabeledComplaints(byLetter);

  return ordered.map(({ letter, text: inlineText }) => {
    const mapped = byLetter.get(letter);
    const picked =
      mapped ||
      pickPairedComplaintText(inlineText || '') ||
      acceptLabeledComplaintText(inlineText || '') ||
      '';
    return { letter, text: picked };
  });
}

function buildGrokComplaintMap(primary: StructuredROExtraction): Map<string, string> {
  const map = new Map<string, string>();
  if (primary.complaintLabels?.length && primary.complaints?.length) {
    primary.complaintLabels.forEach((label, index) => {
      const text = acceptLabeledComplaintText(primary.complaints[index] || '');
      if (text) map.set(label.toUpperCase(), text);
    });
    if (map.size > 0) return map;
  }

  primary.complaints.forEach((complaint, index) => {
    const text = acceptLabeledComplaintText(complaint);
    if (text) map.set(String.fromCharCode(65 + index), text);
  });
  return map;
}

function mergeComplaintsWithGrokFallback(
  ocrText: string,
  grokPrimary: StructuredROExtraction
): RecoveredComplaints {
  const grokMap = buildGrokComplaintMap(grokPrimary);
  const ordered = extractOrderedHashtagComplaints(ocrText);
  const grokLabels =
    grokPrimary.complaintLabels?.length && grokPrimary.complaintLabels.length > 0
      ? grokPrimary.complaintLabels.map((l) => l.toUpperCase())
      : [...grokMap.keys()];
  const ocrSlotLabels = collectComplaintSlotLabelsInOrder(ocrText);
  const pairedLabels = ordered.map((entry) => entry.letter);
  const primaryOrder =
    grokLabels.length >= ocrSlotLabels.length && grokLabels.length > 0
      ? grokLabels
      : mergeLabelOrder(ocrSlotLabels, pairedLabels);
  const allLetters = mergeLabelOrder(primaryOrder, ocrSlotLabels, pairedLabels, grokLabels);

  if (allLetters.length >= 1) {
    const byOcr = new Map(ordered.map((entry) => [entry.letter, entry.text]));
    const complaints: string[] = [];
    const labels: string[] = [];

    for (const letter of allLetters) {
      const grokText = grokMap.get(letter) || '';
      const ocrInline = byOcr.get(letter) || '';
      const picked = pickBestComplaintCandidate(ocrInline, grokText);
      labels.push(letter);
      complaints.push(picked);
    }

    const dedupedComplaints = resolveDuplicateComplaintTexts(labels, complaints, grokMap, ocrText);
    const collapsed = collapseDuplicateAdvisorSlots(
      labels.map((letter, idx) => ({ letter, text: dedupedComplaints[idx] || '' }))
    );
    return labeledComplaintsToArrays(collapsed);
  }

  return recoverComplaintsWithLabelsFromText(ocrText, grokPrimary.complaints);
}

export function labeledComplaintsToArrays(
  labeled: LabeledComplaint[]
): { complaints: string[]; labels: string[] } {
  return {
    complaints: labeled.map((item) => item.text),
    labels: labeled.map((item) => item.letter),
  };
}

export function extractComplaints(text: string): string[] {
  const letterLabeled = extractLetterLabeledComplaints(text);
  if (letterLabeled.length > 0) return letterLabeled.slice(0, 15);

  if (!text || text.trim().length < 6) return [];
  const comps: string[] = [];
  const lines = text.replace(/=== PAGE \d+ ===/g, '\n\n').split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

  const TRIGGERS = [
    'customer states',
    'customer complaint',
    'customer concern',
    'customer reported',
    'customer states that',
    'technician notes',
    'tech notes',
    'technician found',
    'technician observed',
    'concern',
    'complaint',
    'issue',
    'problem',
    'needs',
    'requires',
    'state inspection',
    'found',
    'observed',
    'reported',
    'requires repair',
    'inspection result',
    'c/s',
    'c s',
  ];

  let collecting = false;
  let currentBlock = '';

  const flushBlock = () => {
    if (currentBlock.length < 8) return;
    const labeledMatches = currentBlock.match(/([A-Z])[\.\)\:\s\-–—–—]+\s*([A-Za-z][^\.]{4,220})/gi) || [];
    if (labeledMatches.length > 0) {
      labeledMatches.forEach((m) => {
        const parsed = m.match(/([A-Z])[\.\)\:\s\-–—–—]+\s*(.+)/i);
        if (!parsed) return;
        const c = normalizeComplaintText(parsed[2]);
        if (isValidComplaintText(c) && !comps.includes(c)) comps.push(c);
      });
    } else {
      const parts = currentBlock
        .split(/[\.\!\?]\s+|\n|;/)
        .map((p) => p.trim())
        .filter((p) => p.length > 4);
      parts.forEach((p) => {
        if (isValidComplaintText(p) && !comps.includes(p)) comps.push(p);
      });
    }
    currentBlock = '';
  };

  for (const line of lines) {
    const lower = line.toLowerCase();
    const hitTrigger = TRIGGERS.some((t) => lower.includes(t));
    if (hitTrigger) {
      flushBlock();
      collecting = true;
      currentBlock = line + '. ';
      continue;
    }
    if (collecting) {
      if (
        /vin|ro\s*#|mileage|odometer|parts|labor|total|authorized|signature|print name|phone/i.test(lower) &&
        !lower.match(/complaint|concern|issue|problem|inspection/)
      ) {
        flushBlock();
        collecting = false;
        continue;
      }
      currentBlock += line + ' ';
    }
    const strayLabel = parseComplaintLabelSegment(line);
    if (strayLabel && isComplaintLetter(strayLabel.letter, strayLabel.text)) {
      const c = normalizeComplaintText(strayLabel.text);
      if (!comps.includes(c)) comps.push(c);
    }
  }
  flushBlock();

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of comps) {
    const key = c.toLowerCase().slice(0, 40);
    if (!seen.has(key) && c.length > 3 && c.length < 280) {
      seen.add(key);
      unique.push(c);
    }
  }
  return unique.slice(0, 10);
}

function pickNonEmpty(primary: string, fallback: string): string {
  const p = (primary || '').trim();
  if (p) return p;
  return (fallback || '').trim();
}

function mergeVehicleFields(primary: VehicleInfo, supplement: VehicleInfo): VehicleInfo {
  const warrantyInfo =
    primary.warrantyInfo || supplement.warrantyInfo
      ? {
          factoryWarranty:
            primary.warrantyInfo?.factoryWarranty || supplement.warrantyInfo?.factoryWarranty,
          cpoWarranty: primary.warrantyInfo?.cpoWarranty || supplement.warrantyInfo?.cpoWarranty,
          extendedElaWarranty:
            primary.warrantyInfo?.extendedElaWarranty ||
            supplement.warrantyInfo?.extendedElaWarranty,
          serviceHistoryNotes:
            primary.warrantyInfo?.serviceHistoryNotes ||
            supplement.warrantyInfo?.serviceHistoryNotes,
        }
      : undefined;

  return {
    vin: pickNonEmpty(primary.vin, supplement.vin),
    year: pickNonEmpty(primary.year, supplement.year),
    make: pickNonEmpty(primary.make, supplement.make),
    model: pickNonEmpty(primary.model, supplement.model),
    engine: pickNonEmpty(primary.engine || '', supplement.engine || '') || undefined,
    mileageIn: pickNonEmpty(primary.mileageIn, supplement.mileageIn),
    mileageOut: pickNonEmpty(primary.mileageOut, supplement.mileageOut),
    warrantyInfo: warrantyInfo && Object.values(warrantyInfo).some(Boolean) ? warrantyInfo : undefined,
  };
}

function normalizeConsensusVin(vin?: string): string {
  const cleaned = (vin || '').replace(/[^A-HJ-NPR-Z0-9]/gi, '').toUpperCase();
  return cleaned.length === 17 ? cleaned : '';
}

function pickConsensusScalar(values: string[], minAgreement = 2): string {
  const normalized = values.map((v) => v.trim()).filter(Boolean);
  if (normalized.length === 0) return '';

  const counts = new Map<string, { count: number; original: string }>();
  for (const value of normalized) {
    const key = value.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { count: 1, original: value });
  }

  let best = '';
  let bestCount = 0;
  for (const { count, original } of counts.values()) {
    if (count > bestCount) {
      bestCount = count;
      best = original;
    }
  }

  return bestCount >= minAgreement ? best : normalized.sort((a, b) => b.length - a.length)[0] || '';
}

function pickConsensusVin(values: string[]): string {
  const vins = values.map(normalizeConsensusVin).filter(Boolean);
  if (vins.length === 0) return '';

  const counts = new Map<string, number>();
  for (const vin of vins) counts.set(vin, (counts.get(vin) || 0) + 1);

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] >= 2) return ranked[0][0];
  if (ranked.length === 1) return ranked[0][0];
  return '';
}

function pickConsensusMileage(values: string[]): string {
  const digits = values
    .map((v) => v.replace(/[^0-9]/g, ''))
    .filter((v) => v.length >= 3 && v.length <= 7);
  if (digits.length === 0) return '';

  const counts = new Map<string, number>();
  for (const value of digits) counts.set(value, (counts.get(value) || 0) + 1);

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] >= 2) return ranked[0][0];
  return digits[0] || '';
}

/**
 * Cross-validate structured fields across OCR passes.
 * Favors values agreed on by 2+ passes to resist single-pass hallucinations.
 */
export function mergeMultiPassOcrExtractions(
  extractions: StructuredROExtraction[],
  rawTexts: string[] = []
): StructuredROExtraction {
  const valid = extractions.filter(Boolean);
  if (valid.length === 0) {
    return {
      vehicle: { vin: '', year: '', make: '', model: '', engine: '', mileageIn: '', mileageOut: '' },
      complaints: [],
      customerName: '',
      roNumber: '',
    };
  }
  if (valid.length === 1) return valid[0];

  let merged = valid[0];
  for (let i = 1; i < valid.length; i++) {
    merged = mergeROExtractions(merged, valid[i], rawTexts[i] || '');
  }

  const consensusRo = pickConsensusScalar(valid.map((e) => e.roNumber || ''));
  const consensusCustomer = pickConsensusScalar(
    valid.map((e) => e.customerName || '').filter((name) => name.length > 2)
  );
  const consensusVin = pickConsensusVin(valid.map((e) => e.vehicle?.vin || ''));
  const consensusMileage = pickConsensusMileage(valid.map((e) => e.vehicle?.mileageIn || ''));
  const consensusYear = pickConsensusScalar(valid.map((e) => e.vehicle?.year || ''));
  const consensusMake = pickConsensusScalar(valid.map((e) => e.vehicle?.make || ''));
  const consensusModel = pickConsensusScalar(valid.map((e) => e.vehicle?.model || ''));
  const consensusAdvisor = pickConsensusScalar(valid.map((e) => e.serviceAdvisorName || ''));

  return {
    ...merged,
    roNumber: consensusRo || merged.roNumber,
    customerName: consensusCustomer || merged.customerName,
    serviceAdvisorName: consensusAdvisor || merged.serviceAdvisorName,
    vehicle: {
      ...merged.vehicle,
      vin: consensusVin || (valid.length === 1 ? merged.vehicle.vin : ''),
      mileageIn: consensusMileage || merged.vehicle.mileageIn,
      year: consensusYear || merged.vehicle.year,
      make: consensusMake || merged.vehicle.make,
      model: consensusModel || merged.vehicle.model,
    },
  };
}

/**
 * Final merge for RO scan: Grok vision + multi-pass OCR + raw OCR text.
 * Cross-validates header fields and preserves the strongest complaint recovery.
 */
export function mergeScanSources(
  grok: StructuredROExtraction | null,
  ocrStructured: StructuredROExtraction | null,
  ocrRawText: string
): StructuredROExtraction {
  const parsedFromRaw = ocrRawText.trim() ? parseStructuredROText(ocrRawText) : null;
  const ocrCandidates = [ocrStructured, parsedFromRaw].filter(Boolean) as StructuredROExtraction[];
  const ocrMerged =
    ocrCandidates.length > 1
      ? mergeMultiPassOcrExtractions(ocrCandidates, [ocrRawText])
      : ocrCandidates[0] || null;

  if (!grok && !ocrMerged) {
    return (
      parsedFromRaw || {
        vehicle: { vin: '', year: '', make: '', model: '', engine: '', mileageIn: '', mileageOut: '' },
        complaints: [],
        customerName: '',
        roNumber: '',
      }
    );
  }
  if (!grok) return ocrMerged!;
  if (!ocrMerged) return grok;

  const complaintMerged = mergeROExtractions(grok, ocrMerged, ocrRawText);
  const validated = mergeMultiPassOcrExtractions([grok, ocrMerged], [ocrRawText]);

  return {
    ...complaintMerged,
    roNumber: validated.roNumber || complaintMerged.roNumber,
    customerName: validated.customerName || complaintMerged.customerName,
    serviceAdvisorName: complaintMerged.serviceAdvisorName || validated.serviceAdvisorName,
    vehicle: {
      ...complaintMerged.vehicle,
      vin: validated.vehicle.vin || complaintMerged.vehicle.vin,
      mileageIn: validated.vehicle.mileageIn || complaintMerged.vehicle.mileageIn,
      mileageOut: complaintMerged.vehicle.mileageOut || complaintMerged.vehicle.mileageOut,
      year: validated.vehicle.year || complaintMerged.vehicle.year,
      make: validated.vehicle.make || complaintMerged.vehicle.make,
      model: validated.vehicle.model || complaintMerged.vehicle.model,
      engine: complaintMerged.vehicle.engine || validated.vehicle.engine,
    },
  };
}

/** Merge Grok vision output with on-device OCR (labels from OCR column, text from best source). */
export function mergeROExtractions(
  primary: StructuredROExtraction,
  supplement: StructuredROExtraction,
  supplementRawText = ''
): StructuredROExtraction {
  const recovered = supplementRawText.trim()
    ? mergeComplaintsWithGrokFallback(supplementRawText, primary)
    : recoverComplaintsWithLabelsFromText('', primary.complaints);

  const finalized = finalizeLabeledComplaints(recovered.complaints, recovered.labels);
  const complaints = finalized.complaints;
  const alignedLabels = finalized.labels;

  return {
    roNumber: pickNonEmpty(primary.roNumber, supplement.roNumber),
    customerName: pickNonEmpty(primary.customerName, supplement.customerName),
    serviceAdvisorName: pickNonEmpty(
      primary.serviceAdvisorName || '',
      supplement.serviceAdvisorName || ''
    ) || undefined,
    vehicle: mergeVehicleFields(primary.vehicle, supplement.vehicle),
    complaints,
    complaintLabels: alignedLabels,
  };
}

function mergeComplaintLists(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const c = normalizeComplaintContent(raw);
      if (!isValidComplaintText(c)) continue;
      if (isInspectionDetailLine(c)) continue;
      const key = c.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(c);
      }
    }
  }
  return merged.slice(0, 15);
}

/** Parse Grok-style "A. text" / "B: text" lines from the complaints section. */
function extractStructuredLetterComplaints(text: string): Map<string, string> {
  const byLetter = new Map<string, string>();
  let inSection = false;

  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const lower = line.toLowerCase();
    if (lower.startsWith('customer complaints:')) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^ro number:|^year:|^make:|^model:|^vin:|^mileage/i.test(lower)) break;
    if (/none listed/i.test(lower)) break;

    const m = line.match(LETTER_LABEL_OUTPUT_PATTERN);
    if (!m) continue;
    const content = normalizeComplaintContent(m[2]);
    if (!isValidComplaintText(content) || isInspectionDetailLine(content)) continue;
    addLetterComplaint(byLetter, m[1], content);
  }

  return byLetter;
}

export interface RecoveredComplaints {
  complaints: string[];
  labels?: string[];
}

/**
 * Recover Line A when Grok skips it or mislabels continuation detail as B.
 * Letter-labeled OCR/raw text is authoritative over Grok structured output.
 */
export function recoverComplaintsFromText(text: string, grokComplaints: string[] = []): string[] {
  return recoverComplaintsWithLabelsFromText(text, grokComplaints).complaints;
}

export function recoverComplaintsWithLabelsFromText(
  text: string,
  grokComplaints: string[] = []
): RecoveredComplaints {
  const letterFromRawMap = extractLetterLabeledComplaintMap(text);
  const structuredLetters = extractStructuredLetterComplaints(text);
  const explicitHashtagLabels = collectExplicitHashtagLabels(text);
  const byLetter = new Map<string, string>();

  // OCR/raw hashtag and line-start labels are authoritative.
  for (const [letter, value] of letterFromRawMap) {
    addLetterComplaint(byLetter, letter, value);
  }

  // Grok structured output only fills gaps when the RO does not use hashtag labels.
  if (explicitHashtagLabels.size === 0) {
    for (const [letter, value] of structuredLetters) {
      if (byLetter.has(letter)) continue;
      if (!letterAppearsAsComplaintLabel(text, letter)) continue;
      addLetterComplaint(byLetter, letter, value);
    }
  }

  // Grok skipped A but labeled continuation detail as B (e.g. "B. RISI RHODE ISLAND...").
  if (!byLetter.has('A')) {
    const risiLineMatch = text.match(/(?:^|\n)\s*B[\.\)\:\s\-–—]+\s*(RISI\s+[^\n]+)/i);
    const risiSources = [
      byLetter.get('B'),
      ...grokComplaints,
      risiLineMatch?.[1],
    ].filter(Boolean) as string[];
    for (const raw of risiSources) {
      if (!/^RISI\s+/i.test(raw)) continue;
      const recoveredA = normalizeComplaintContent(raw);
      if (isValidComplaintText(recoveredA)) {
        byLetter.set('A', recoveredA);
        const bValue = byLetter.get('B');
        if (
          bValue &&
          (bValue === raw ||
            bValue === recoveredA ||
            normalizeComplaintContent(bValue) === recoveredA)
        ) {
          byLetter.delete('B');
        }
        break;
      }
    }
  }

  if (byLetter.size > 0) {
    const ordered = labeledComplaintsInDocumentOrder(text, byLetter);
    const seenLetters = new Set<string>();
    const complaints: string[] = [];
    const labels: string[] = [];
    for (const { letter, text: value } of ordered) {
      if (seenLetters.has(letter)) continue;
      seenLetters.add(letter);
      labels.push(letter);
      complaints.push(value);
    }
    return { complaints, labels };
  }

  const fallback = filterComplaintList(
    mergeComplaintLists(
      [...letterFromRawMap.values()],
      grokComplaints,
      extractComplaints(text)
    )
  );
  return { complaints: fallback };
}

export function extractVehicleDetails(text: string): VehicleInfo {
  let cleaned = text
    .replace(/\bO\b/g, '0')
    .replace(/\bI\b/g, '1')
    .replace(/\bL\b/g, '1')
    .replace(/[\u2018\u2019]/g, "'");

  const topBlock = cleaned.substring(0, 500);
  const vinMatch = cleaned.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  let vin = vinMatch ? vinMatch[1] : '';
  if (vin) {
    vin = vin.toUpperCase().replace(/O/g, '0').replace(/I/g, '1').replace(/Q/g, '0').replace(/B/g, '8');
    if (!vin.match(/^[A-HJ-NPR-Z0-9]{17}$/)) vin = '';
  }

  const headerText = cleaned.substring(0, 600);
  let year = '';
  const myMatch =
    headerText.match(/\bM\.?Y\.?\s*(20\d{2}|19\d{2})\b/i) ||
    headerText.match(/\bModel\s*Year\s*(20\d{2}|19\d{2})\b/i) ||
    headerText.match(/\b(20\d{2}|19\d{2})\s*MY\b/i);
  if (myMatch) year = myMatch[1];
  if (!year) {
    const yearBefore = headerText.match(
      /\b(20\d{2}|19\d{2})\s+(?:Mercedes|Maybach|MB|GLE|GLS|GLC|GLA|S\s|E\s|C\s|EQ|AMG|GT|SL|CLS|CLA)\b/i
    );
    if (yearBefore) year = yearBefore[1];
  }
  if (!year) {
    const yearAny = headerText.match(/\b(20\d{2}|19\d{2})\b/);
    if (yearAny) year = yearAny[1];
  }

  let make = 'Mercedes-Benz';
  if (/Maybach/i.test(headerText)) make = 'Maybach';
  else if (/Mercedes[- ]?Benz/i.test(headerText) || /\bMercedes\b/i.test(headerText)) make = 'Mercedes-Benz';
  else if (/Mercedes[- ]?Benz/i.test(headerText) || /\bMB\b/i.test(headerText) || /\bMERCEDES\b/i.test(headerText))
    make = 'Mercedes-Benz';
  else if (
    vin.startsWith('W1') ||
    vin.startsWith('WDD') ||
    vin.startsWith('WDC') ||
    vin.startsWith('WDF') ||
    vin.startsWith('W1N') ||
    vin.startsWith('W1K')
  ) {
    make = 'Mercedes-Benz';
  }

  let model = '';
  const modelPatterns = [
    /\b(Maybach\s+)?(?:GLE|GLS|GLC|GLA|GLB|G)\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|4M|AMG|Maybach|Coupe|SUV|Cabriolet))?\b/i,
    /\b(Maybach\s+)?S\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG|Maybach|Maybach\s+S))?\b/i,
    /\b(Maybach\s+)?E\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\b(Maybach\s+)?C\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\b(?:EQE|EQS|EQB|EQC|EQ)\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\bAMG\s*(?:GT|SL|GLE|GLS|G)\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\b(?:CLS|CLA|SL|GT|ML|GL)\s*\d{2,3}[A-Z]?(?:\s*(?:4MATIC|AMG))?\b/i,
    /\b(?:Sprinter|Vito|Metris)\b/i,
  ];
  for (const re of modelPatterns) {
    const m = headerText.match(re);
    if (m) {
      model = m[0].replace(/\s+/g, ' ').trim();
      break;
    }
  }
  if (!model) {
    const generic = headerText.match(/\b(?:20\d{2}|19\d{2}|Mercedes|Maybach|MB)\s+([A-Z]{1,4}[\s-]?\d{2,3}[A-Z0-9\s-]{0,10})/i);
    if (generic && generic[1]) model = generic[1].trim();
  }
  model = model.replace(/\b4\s*MATIC\b/i, '4MATIC').replace(/\s+/g, ' ').trim();

  let mileageIn = '';
  const labeled = headerText.match(
    /(?:MILEAGE\s*IN|MILEAGE IN|mileage\s*in|odometer|current\s*(?:mile|km)|miles\s*in)\s*:?\s*([\d,]{3,7})/i
  );
  if (labeled) {
    mileageIn = labeled[1].replace(/,/g, '');
  } else {
    const any = cleaned.match(/([\d,]{4,7})\s*(?:mi|mile|miles|km)\b/i);
    if (any) mileageIn = any[1].replace(/,/g, '');
  }

  return { vin, year, make, model, mileageIn, mileageOut: '' };
}

const ADVISOR_LABEL_PATTERN =
  /^(?:service\s+advisor(?:\s+name)?|svc\.?\s*advisor|advisor(?:\s+name)?|sa|writer)\s*:?\s*(.+)$/i;

/** Extract service advisor name from RO header / structured Grok output. */
export function extractServiceAdvisorFromText(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 40)) {
    const labeled = line.match(ADVISOR_LABEL_PATTERN);
    if (labeled?.[1]) {
      const name = labeled[1].trim();
      if (name.length >= 3 && name.length <= 48 && /[A-Za-z]/.test(name)) return name;
    }
  }

  const header = text.substring(0, 1200);
  const inlinePatterns = [
    /(?:service\s+advisor|svc\.?\s*advisor|advisor)\s*:?\s*([A-Z][A-Za-z'\-\.\s]{2,40})/i,
    /\bSA\s*:?\s*([A-Z][A-Za-z'\-\.\s]{2,35})/,
    /(?:written\s+by|prepared\s+by)\s*:?\s*([A-Z][A-Za-z'\-\.\s]{2,40})/i,
  ];
  for (const pattern of inlinePatterns) {
    const match = header.match(pattern);
    if (match?.[1]) {
      const name = match[1].trim().replace(/\s{2,}/g, ' ');
      if (name.length >= 3 && !/vin|mileage|customer|technician|tech\b/i.test(name)) return name;
    }
  }

  return '';
}

export function extractCustomerName(text: string): string {
  const top = text.substring(0, 400);
  const patterns = [
    /customer\s*(?:name|:)?:?\s*([A-Z][A-Za-z'\-\s]{2,40})/i,
    /(?:name|owner)\s*:?\s*([A-Z][A-Za-z'\-\s]{2,40})/i,
    /^([A-Z][A-Za-z'\-\s]{2,30})\s*(?:RO|Repair|Vehicle|VIN)/im,
  ];
  for (const p of patterns) {
    const m = top.match(p) || text.match(p);
    if (m && m[1]) {
      const n = m[1].trim();
      if (n.length > 2 && n.length < 45 && !/vin|mile|ro|tech/i.test(n)) return n;
    }
  }
  return '';
}

export function parseStructuredROText(text: string): StructuredROExtraction {
  const vehicle: VehicleInfo = { vin: '', year: '', make: '', model: '', mileageIn: '', mileageOut: '' };
  let structuredComplaints: string[] = [];
  let customerName = '';
  let roNumber = '';
  let serviceAdvisorName = '';

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let inComplaints = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('ro number:')) {
      roNumber = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('service advisor name:') || lower.startsWith('service advisor:')) {
      serviceAdvisorName = (line.split(':').slice(1).join(':') || '').trim();
    } else if (lower.startsWith('year:')) {
      vehicle.year = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('make:')) {
      vehicle.make = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('model:')) {
      vehicle.model = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('mileage in:')) {
      vehicle.mileageIn = (line.split(':')[1] || '').replace(/[^0-9]/g, '');
    } else if (lower.startsWith('vin:')) {
      vehicle.vin = (line.split(':')[1] || '').replace(/[^A-HJ-NPR-Z0-9]/gi, '').toUpperCase();
    } else if (lower.startsWith('customer name:')) {
      customerName = (line.split(':')[1] || '').trim();
    } else if (lower.startsWith('customer complaints:')) {
      inComplaints = true;
      continue;
    }

    if (inComplaints) {
      if (/none listed/i.test(line)) {
        structuredComplaints = [];
        inComplaints = false;
        continue;
      }
      if (/^customer complaints?:?$/i.test(lower)) {
        continue;
      }
      if (/^ro number:|^year:|^make:|^model:|^vin:|^mileage/i.test(lower)) {
        inComplaints = false;
        continue;
      }

      const parsed = parseComplaintLabelSegment(line);
      if (parsed) {
        const c = trimComplaintContinuation(parsed.text);
        if (isValidComplaintText(c)) structuredComplaints.push(c);
      } else {
        const numbered = line.match(/^(\d{1,2})[\.\)\:\s\-–—–—]+\s*(.+)$/i);
        if (numbered && numbered[2]) {
          const c = trimComplaintContinuation(numbered[2]);
          if (isValidComplaintText(c)) structuredComplaints.push(c);
        } else if (isValidComplaintText(line)) {
          structuredComplaints.push(normalizeComplaintText(line));
        }
      }
    }
  }

  if (!roNumber) {
    const m = text.match(/(?:RO Number|RO#|Repair Order|Work Order)[:\s#]*([A-Z0-9\-]{3,12})/i);
    if (m) roNumber = m[1];
  }
  if (!vehicle.vin) {
    const m = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (m) vehicle.vin = m[1].toUpperCase();
  }
  if (!vehicle.year) {
    const m = text.match(/\b(20\d{2}|19\d{2})\b/);
    if (m) vehicle.year = m[1];
  }
  if (!vehicle.make || vehicle.make === 'Mercedes-Benz') {
    if (/Maybach/i.test(text)) vehicle.make = 'Maybach';
    else if (/Mercedes/i.test(text)) vehicle.make = 'Mercedes-Benz';
  }
  if (!vehicle.model) {
    const m = text.match(/\b(GLE|GLS|GLC|GLA|S\s*\d|E\s*\d|C\s*\d|EQ[A-Z]?\s*\d|AMG)\s*\d{0,3}[A-Z]?(?:\s*4MATIC|AMG)?\b/i);
    if (m) vehicle.model = m[0].trim();
  }
  if (!vehicle.mileageIn) {
    const m = text.match(/(?:mileage in|odometer)[:\s]*([\d,]{3,7})/i);
    if (m) vehicle.mileageIn = m[1].replace(/,/g, '');
  }
  if (!customerName) {
    const m = text.match(/customer name[:\s]*([A-Z][A-Za-z'\-\s]{2,35})/i);
    if (m) customerName = m[1].trim();
  }
  if (!serviceAdvisorName) {
    serviceAdvisorName = extractServiceAdvisorFromText(text);
  }

  const recovered = recoverComplaintsWithLabelsFromText(
    text,
    mergeComplaintLists(structuredComplaints, extractComplaints(text))
  );

  if (vehicle.vin && vehicle.vin.length !== 17) {
    vehicle.vin = vehicle.vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17).toUpperCase();
  }
  vehicle.mileageIn = (vehicle.mileageIn || '').replace(/[^0-9]/g, '');

  return {
    vehicle,
    complaints: recovered.complaints,
    complaintLabels: recovered.labels,
    customerName,
    roNumber,
    serviceAdvisorName: serviceAdvisorName || undefined,
  };
}

export function extractRoNumberFromText(text: string): string {
  return (
    (text.match(/(?:^|\n)\s*(?:RO\s*#?|Repair\s*Order|Work\s*Order|RO#)\s*[:#]?\s*([A-Z0-9\-]{3,12})/im) || [])[1] ||
    (text.match(/(?:RO|Repair Order|Work Order)\s*[:#]?\s*([A-Z0-9\-]{3,12})/i) || [])[1] ||
    `R-${Date.now().toString().slice(-6)}`
  );
}

export function sanitizeComplaints(complaints: string[]): string[] {
  return complaints
    .map((c) => normalizeComplaintForDisplay(c))
    .filter((c) => isAcceptableRoLineText(c))
    .slice(0, 15);
}

/** Keep every lettered complaint slot (A–F) — do not drop short/QC/empty lines. */
export function finalizeLabeledComplaints(
  complaints: string[],
  labels?: string[]
): { complaints: string[]; labels?: string[] } {
  if (!labels || labels.length === 0) {
    return { complaints: sanitizeComplaints(complaints) };
  }

  const outComplaints: string[] = [];
  const outLabels: string[] = [];
  const seenLetters = new Set<string>();

  complaints.forEach((raw, index) => {
    const label = labels[index]?.toUpperCase();
    if (!label || seenLetters.has(label)) return;
    seenLetters.add(label);

    const cleaned =
      pickPairedComplaintText(raw) ||
      acceptLabeledComplaintText(raw) ||
      normalizeComplaintForDisplay(raw);
    outLabels.push(label);
    outComplaints.push(isObviousOcrGarbage(cleaned) ? '' : cleaned);
  });

  return {
    complaints: outComplaints.slice(0, 20),
    labels: outLabels.length === outComplaints.length ? outLabels : undefined,
  };
}

export function sanitizeVehicle(vehicle: VehicleInfo): VehicleInfo {
  const v = { ...vehicle };
  if (v.vin && v.vin.length !== 17) {
    v.vin = v.vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').slice(0, 17).toUpperCase();
  }
  v.mileageIn = (v.mileageIn || '').replace(/[^0-9]/g, '');
  return v;
}