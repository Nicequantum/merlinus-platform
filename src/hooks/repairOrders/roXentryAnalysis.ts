import { api, ApiError } from '@/lib/api';
import { clientLog } from '@/lib/clientLog';
import { isRequestAborted } from '@/lib/requestAbort';
import { formatScanApiError } from '@/lib/scanPipeline';
import { runDiagnosticOCR } from '@/services/ocr';
import type { ExtractedData, ImageAttachment } from '@/types';
import {
  emptyExtractedData,
  formatExtractionAsOcrText,
  mergeExtracted,
  parseDiagnosticExtraction,
} from '@/utils/diagnosticParser';

function hasDiagnosticContent(data: Partial<ExtractedData>): boolean {
  if (data.codes?.length) return true;
  if (data.faultCodes?.length) return true;
  if (data.measurements?.length) return true;
  if (data.guidedTests?.length) return true;
  if (data.components?.length) return true;
  if (data.circuits?.length) return true;
  return false;
}

export async function analyzeXentryImage(
  file: File,
  attachment: ImageAttachment,
  onProgress: (p: number) => void,
  options?: { signal?: AbortSignal }
): Promise<{ text: string; extracted: Partial<ExtractedData> }> {
  const signal = options?.signal;
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  };

  let extracted: Partial<ExtractedData> = {};
  let text = '';
  const startedAt = Date.now();

  throwIfAborted();
  onProgress(10);
  let extractError: string | null = null;
  try {
    clientLog.info('xentry.vision_start', { pathname: attachment.pathname });
    const grokData = await api.extractDiagnostics(attachment.pathname, { signal });
    extracted = mergeExtracted(emptyExtractedData(), grokData);
    text = formatExtractionAsOcrText(grokData);
    onProgress(50);
    clientLog.info('xentry.vision_done', {
      pathname: attachment.pathname,
      durationMs: Date.now() - startedAt,
      hasContent: hasDiagnosticContent(extracted),
    });
  } catch (err) {
    if (isRequestAborted(err)) throw err;
    extractError = formatScanApiError(err);
    clientLog.error('xentry.extract_api_failed', {
      message: extractError,
      status: err instanceof ApiError ? err.status : undefined,
      pathname: attachment.pathname,
      durationMs: Date.now() - startedAt,
    });
  }

  if (hasDiagnosticContent(extracted)) {
    onProgress(100);
    return { text: text.trim() || formatExtractionAsOcrText(extracted), extracted };
  }

  throwIfAborted();
  try {
    clientLog.info('xentry.ocr_fallback_start', {
      pathname: attachment.pathname,
      elapsedMs: Date.now() - startedAt,
    });
    const ocrText = await runDiagnosticOCR(
      file,
      (p) => onProgress(text ? 50 + Math.round(p * 0.45) : Math.round(p * 0.9)),
      { signal }
    );
    if (ocrText.trim()) {
      const ocrExtracted = parseDiagnosticExtraction(ocrText);
      extracted = mergeExtracted(mergeExtracted(emptyExtractedData(), extracted), ocrExtracted);
      text = text ? `${text}\n\n[OCR SUPPLEMENT]\n${ocrText}` : ocrText;
    }
    clientLog.info('xentry.ocr_fallback_done', {
      pathname: attachment.pathname,
      durationMs: Date.now() - startedAt,
      textLen: text.length,
    });
  } catch (err) {
    if (isRequestAborted(err)) throw err;
    clientLog.error('xentry.ocr_failed', {
      pathname: attachment.pathname,
      error: err instanceof Error ? err.message : 'unknown',
      durationMs: Date.now() - startedAt,
    });
  }

  if (!text.trim()) {
    text = extractError
      ? `[Analysis failed: ${extractError}]`
      : '[No diagnostic text extracted from image]';
  } else if (extractError && !hasDiagnosticContent(extracted)) {
    text = `${text}\n\n[AI vision note: ${extractError}]`;
  }

  return { text, extracted };
}