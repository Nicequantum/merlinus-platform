import { XENTRY_PENDING_ANALYSIS_OCR } from '@/lib/xentryAnalysisState';
import type { ExtractedData, ImageAttachment, RepairOrder } from '@/types';
import { emptyExtractedData, normalizeExtractedData } from '@/utils/diagnosticParser';

/** Where diagnostic photos are captured — RO header vs a specific repair line. */
export type XentryTarget =
  | { scope: 'line'; lineId: string }
  | { scope: 'ro'; roId: string };

/**
 * M1: Canonical Xentry storage rules (no dual-write confusion).
 *
 * - `scope: 'ro'` — images + OCR text live on RepairOrder; merged extractedData lives on
 *   repair line 1 only (story generation entry point from the RO view).
 * - `scope: 'line'` — images, OCR, and extractedData all live on that repair line.
 */
export function targetKey(target: XentryTarget): string {
  return target.scope === 'line' ? `line:${target.lineId}` : `ro:${target.roId}`;
}

export function readXentryBaseline(
  ro: RepairOrder,
  target: XentryTarget
): {
  images: ImageAttachment[];
  ocrTexts: string[];
  extracted: ExtractedData;
} {
  if (target.scope === 'line') {
    const line = ro.repairLines.find((l) => l.id === target.lineId);
    return {
      images: line?.xentryImages ?? [],
      ocrTexts: line?.xentryOcrTexts ?? [],
      extracted: normalizeExtractedData(line?.extractedData ?? emptyExtractedData()),
    };
  }

  const line0 = ro.repairLines[0];
  return {
    images: ro.xentryImages ?? [],
    ocrTexts: ro.xentryOcrTexts ?? [],
    extracted: normalizeExtractedData(line0?.extractedData ?? emptyExtractedData()),
  };
}

/** UI-facing read — same storage rules as baseline (used by buildXentrySection). */
export function readXentryViewState(
  ro: RepairOrder | null | undefined,
  target: XentryTarget
): {
  images: ImageAttachment[];
  extracted: ExtractedData | undefined;
} {
  if (!ro) return { images: [], extracted: undefined };
  const baseline = readXentryBaseline(ro, target);
  return {
    images: baseline.images,
    extracted: baseline.extracted,
  };
}

/** Append one uploaded diagnostic photo — idempotent when the attachment id already exists. */
export function appendXentryImage(
  ro: RepairOrder,
  target: XentryTarget,
  attachment: ImageAttachment
): RepairOrder {
  const baseline = readXentryBaseline(ro, target);
  if (baseline.images.some((img) => img.id === attachment.id)) {
    return ro;
  }
  return applyXentrySnapshot(
    ro,
    target,
    [...baseline.images, attachment],
    [...baseline.ocrTexts, XENTRY_PENDING_ANALYSIS_OCR],
    baseline.extracted
  );
}

export function applyXentrySnapshot(
  ro: RepairOrder,
  target: XentryTarget,
  images: ImageAttachment[],
  ocrTexts: string[],
  extracted: ExtractedData
): RepairOrder {
  if (target.scope === 'line') {
    return {
      ...ro,
      repairLines: ro.repairLines.map((line) =>
        line.id === target.lineId
          ? { ...line, xentryImages: images, xentryOcrTexts: ocrTexts, extractedData: extracted }
          : line
      ),
    };
  }

  const line0 = ro.repairLines[0];
  const repairLines = line0
    ? ro.repairLines.map((line, idx) => (idx === 0 ? { ...line, extractedData: extracted } : line))
    : ro.repairLines;

  return {
    ...ro,
    xentryImages: images,
    xentryOcrTexts: ocrTexts,
    repairLines,
  };
}