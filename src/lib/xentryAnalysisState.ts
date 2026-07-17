/** OCR placeholder written when a diagnostic photo is auto-saved before AI analysis. */
export const XENTRY_PENDING_ANALYSIS_OCR = '[Saved — tap Process to analyze]';

export function xentryImageNeedsAnalysis(ocrTexts: string[] | undefined, imageIndex: number): boolean {
  const text = ocrTexts?.[imageIndex]?.trim() ?? '';
  if (!text) return true;
  if (text === XENTRY_PENDING_ANALYSIS_OCR) return true;
  if (text === '[Analyzing diagnostic photo…]') return true;
  if (text.startsWith('[Analysis failed')) return true;
  if (text === '[No diagnostic text extracted from image]') return true;
  return false;
}

export function countXentryImagesNeedingAnalysis(
  images: { id: string }[],
  ocrTexts: string[] | undefined
): number {
  return images.filter((_, index) => xentryImageNeedsAnalysis(ocrTexts, index)).length;
}