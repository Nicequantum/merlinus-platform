/** True when an Xentry per-image OCR/analysis result represents a failure. */
export function isXentryAnalysisFailure(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return (
    trimmed.includes('[Analysis failed:') ||
    trimmed.includes('[Analysis failed for this image]') ||
    trimmed.includes('[No diagnostic text extracted from image]')
  );
}

/** User-facing detail for a failed Xentry analysis line, when available. */
export function xentryAnalysisFailureDetail(text: string): string {
  const colonMatch = text.match(/\[Analysis failed: (.+)\]/);
  if (colonMatch?.[1]?.trim()) return colonMatch[1].trim();
  if (text.includes('[Analysis failed for this image]')) {
    return 'Could not analyze this image — try a sharper photo.';
  }
  if (text.includes('[No diagnostic text extracted from image]')) {
    return 'No diagnostic text could be read from this image.';
  }
  return 'Diagnostic analysis failed.';
}