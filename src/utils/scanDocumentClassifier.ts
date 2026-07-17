/** Detect Vehicle Master Inquiry (VMI) pages — separate from Repair Order complaint pages. */
const VMI_STRONG_MARKERS = [
  /\bvehicle\s+master\s+inquiry\b/i,
  /\bVMI\b/,
];

const VMI_SUPPORTING_MARKERS = [
  /factory\s+warranty/i,
  /cpo\s+warranty/i,
  /certified\s+pre[- ]?owned/i,
  /extended\s+ela\b/i,
  /ela\s+warranty/i,
  /warranty\s+(?:start|end|expiration|expir)/i,
  /service\s+history/i,
  /campaign\s+(?:open|closed)/i,
  /open\s+field\s+actions?/i,
];

const RO_STRONG_MARKERS = [
  /LINE\s+OP(?:\s*CODE|CODE)?\s+TECH\s+TYPE/i,
  /repair\s+order/i,
  /work\s+order/i,
  /#\s*[A-Z]\b/,
  /customer\s+complaints?/i,
];

export type ScanPageKind = 'repair_order' | 'vmi' | 'unknown';

export function classifyScanPageText(text: string): ScanPageKind {
  const trimmed = text?.trim() || '';
  if (!trimmed) return 'unknown';

  if (VMI_STRONG_MARKERS.some((pattern) => pattern.test(trimmed))) {
    return 'vmi';
  }

  const vmiHits = VMI_SUPPORTING_MARKERS.filter((pattern) => pattern.test(trimmed)).length;
  const roHits = RO_STRONG_MARKERS.filter((pattern) => pattern.test(trimmed)).length;

  if (vmiHits >= 2 && roHits === 0) return 'vmi';
  if (roHits >= 1) return 'repair_order';
  if (vmiHits >= 3) return 'vmi';

  return 'unknown';
}

export function isVmiDocumentText(text: string): boolean {
  return classifyScanPageText(text) === 'vmi';
}

export function isRepairOrderDocumentText(text: string): boolean {
  return classifyScanPageText(text) === 'repair_order';
}

export interface ClassifiedScanPage {
  pageNumber: number;
  kind: ScanPageKind;
  text: string;
}

const PAGE_MARKER_PATTERN = /===?\s*PAGE\s+(\d+)\s*===?/gi;

/** Split combined multi-page OCR into classified page records. */
export function classifyScanPages(combinedText: string): ClassifiedScanPage[] {
  const normalized = combinedText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const pages: ClassifiedScanPage[] = [];
  const parts = normalized.split(PAGE_MARKER_PATTERN);
  if (parts.length <= 1) {
    pages.push({ pageNumber: 1, kind: classifyScanPageText(normalized), text: normalized });
    return pages;
  }

  let pageNumber = 1;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]?.trim();
    if (!part) continue;
    if (/^\d+$/.test(part)) {
      pageNumber = Number(part);
      continue;
    }
    pages.push({
      pageNumber,
      kind: classifyScanPageText(part),
      text: part,
    });
  }

  return pages;
}

/** Rebuild OCR text using only repair-order pages (drops VMI pages from complaint extraction). */
export function combineRepairOrderPages(pages: ClassifiedScanPage[]): string {
  const roPages = pages.filter((page) => page.kind === 'repair_order' || page.kind === 'unknown');
  if (roPages.length === 0) return '';
  return roPages.map((page) => `=== PAGE ${page.pageNumber} ===\n${page.text}`).join('\n\n');
}

export function combineVmiPages(pages: ClassifiedScanPage[]): string {
  const vmiPages = pages.filter((page) => page.kind === 'vmi');
  if (vmiPages.length === 0) return '';
  return vmiPages.map((page) => `=== PAGE ${page.pageNumber} ===\n${page.text}`).join('\n\n');
}