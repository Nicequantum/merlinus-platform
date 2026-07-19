/**
 * Enterprise Video MPI client — chunked/resumable uploads to R2.
 *
 * Progress stays accurate past init (2%): each chunk reports start + completion.
 * Every fetch has a hard timeout so stalls never hang forever at ~2%.
 */

import {
  VIDEO_CHUNK_CLIENT_RETRIES,
  VIDEO_UPLOAD_CHUNK_BYTES,
  VIDEO_UPLOAD_CHUNK_TIMEOUT_MS,
  VIDEO_UPLOAD_COMPLETE_TIMEOUT_MS,
  VIDEO_UPLOAD_INIT_TIMEOUT_MS,
  VIDEO_UPLOAD_SINGLE_TIMEOUT_MS,
  expectedChunkCount,
} from '@/lib/videoInspection/uploadConstants';
import type { PendingVideoUploadMeta } from '@/lib/videoInspection/offlineQueue';
import type { VideoInspectionDetail } from '@/types';

export type UploadProgress = {
  phase: 'init' | 'chunk' | 'complete' | 'done';
  chunksTotal: number;
  chunksSent: number;
  percent: number;
  message?: string;
  bytesSent?: number;
  bytesTotal?: number;
};

export interface ChunkedUploadInput {
  video: Blob;
  frames?: Blob[];
  meta: PendingVideoUploadMeta & { title?: string };
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

class UploadHttpError extends Error {
  readonly status: number;
  readonly retriable: boolean;

  constructor(message: string, status: number, retriable: boolean) {
    super(message);
    this.name = 'UploadHttpError';
    this.status = status;
    this.retriable = retriable;
  }
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a && !b) return undefined;
  if (a && !b) return a;
  if (b && !a) return b;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a!.addEventListener('abort', onAbort, { once: true });
  b!.addEventListener('abort', onAbort, { once: true });
  if (a!.aborted || b!.aborted) controller.abort();
  return controller.signal;
}

async function fetchJsonWithTimeout<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal
): Promise<{ res: Response; body: T & { error?: string } }> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = mergeSignals(outerSignal, timeoutController.signal);
  try {
    const res = await fetch(path, {
      ...init,
      credentials: 'include',
      signal,
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { res, body };
  } catch (error) {
    if (outerSignal?.aborted) {
      throw new DOMException('Upload cancelled', 'AbortError');
    }
    if (timeoutController.signal.aborted) {
      throw new Error(
        `Upload timed out after ${Math.round(timeoutMs / 1000)}s — check bay Wi‑Fi and try again`
      );
    }
    throw error instanceof Error ? error : new Error('Network error during upload');
  } finally {
    clearTimeout(timer);
  }
}

function assertOk(res: Response, body: { error?: string }, fallback: string): void {
  if (res.ok) return;
  const message = body.error || fallback;
  throw new UploadHttpError(message, res.status, isRetriableStatus(res.status));
}

async function putChunkWithRetry(
  sessionId: string,
  index: number,
  totalChunks: number,
  chunk: Blob,
  signal?: AbortSignal,
  onRetry?: (attempt: number, message: string) => void
): Promise<void> {
  let lastError: Error | null = null;
  const maxAttempts = VIDEO_CHUNK_CLIENT_RETRIES;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    try {
      const form = new FormData();
      form.append('sessionId', sessionId);
      form.append('chunkIndex', String(index));
      form.append('totalChunks', String(totalChunks));
      form.append('chunk', chunk, `chunk-${index}.part`);

      const { res, body } = await fetchJsonWithTimeout<{ ok?: boolean; error?: string }>(
        '/api/video-inspections/upload/chunk',
        { method: 'POST', body: form },
        VIDEO_UPLOAD_CHUNK_TIMEOUT_MS,
        signal
      );

      if (!res.ok) {
        const retriable = isRetriableStatus(res.status);
        const err = new UploadHttpError(
          body.error || `Chunk ${index + 1}/${totalChunks} failed (${res.status})`,
          res.status,
          retriable
        );
        if (!retriable) throw err;
        throw err;
      }
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = error instanceof Error ? error : new Error('Chunk upload failed');
      const retriable =
        error instanceof UploadHttpError
          ? error.retriable
          : /timeout|network|fetch|failed to fetch|offline|temporar|503|502|504|429/i.test(
              lastError.message
            );
      if (!retriable || attempt >= maxAttempts - 1) {
        throw lastError;
      }
      const base = 600 * Math.pow(1.7, attempt);
      const jitter = Math.floor(Math.random() * 300);
      const waitMs = Math.min(12_000, base + jitter);
      onRetry?.(attempt + 1, lastError.message);
      await sleep(waitMs);
    }
  }
  throw lastError || new Error('Chunk upload failed');
}

/** Strip codec params so server allowlists match browser MediaRecorder types. */
function normalizeContentType(raw: string, recordingMode?: string): string {
  const base = (raw || '').split(';')[0]?.trim().toLowerCase() || '';
  if (
    base === 'video/webm' ||
    base === 'video/mp4' ||
    base === 'video/quicktime' ||
    base === 'video/x-matroska'
  ) {
    return base;
  }
  if (base.includes('mp4') || base.includes('quicktime')) return 'video/mp4';
  if (base.includes('webm')) return 'video/webm';
  if (recordingMode === 'upload') return 'video/mp4';
  return 'video/webm';
}

function percentForChunks(sent: number, total: number, phase: 'chunk' | 'complete' | 'done'): number {
  if (phase === 'done') return 100;
  if (phase === 'complete') return 92;
  if (total <= 0) return 5;
  // Reserve 0–4% init, 5–90% chunks, 91–99% assemble, 100 done
  return Math.min(90, 5 + Math.round((sent / total) * 85));
}

/**
 * Prefer chunked upload for reliability; falls back to single multipart when tiny.
 */
export async function uploadVideoInspectionResumable(
  input: ChunkedUploadInput
): Promise<{ inspection: VideoInspectionDetail }> {
  const { frames = [], meta, onProgress, signal } = input;
  const contentType = normalizeContentType(input.video.type || '', meta.recordingMode);
  // Avoid copying the full blob when MIME already matches (large multi-minute videos).
  const video =
    input.video.type === contentType
      ? input.video
      : new Blob([input.video], { type: contentType });

  const totalBytes = video.size;
  if (totalBytes < 256) {
    throw new Error('Recording produced no usable video data');
  }

  const totalChunks = expectedChunkCount(totalBytes, VIDEO_UPLOAD_CHUNK_BYTES);

  // Small files: single-shot multipart (still used for frames convenience)
  if (totalBytes > 0 && totalBytes <= VIDEO_UPLOAD_CHUNK_BYTES) {
    onProgress?.({
      phase: 'complete',
      chunksTotal: 1,
      chunksSent: 0,
      percent: 8,
      message: 'Uploading video…',
      bytesSent: 0,
      bytesTotal: totalBytes,
    });
    const form = new FormData();
    const ext =
      contentType.includes('mp4') || contentType.includes('quicktime') ? 'mp4' : 'webm';
    form.append('file', video, `inspection.${ext}`);
    form.append('title', meta.title || 'Video inspection');
    if (meta.vehicleLabel) form.append('vehicleLabel', meta.vehicleLabel);
    if (meta.customerName) form.append('customerName', meta.customerName);
    if (meta.customerPhone) form.append('customerPhone', meta.customerPhone);
    if (meta.vin) form.append('vin', meta.vin);
    if (meta.transcript) form.append('transcript', meta.transcript);
    if (meta.transcriptLanguage) form.append('transcriptLanguage', meta.transcriptLanguage);
    if (meta.recordingMode) form.append('recordingMode', meta.recordingMode);
    if (meta.durationSec) form.append('durationSec', String(meta.durationSec));
    if (meta.repairOrderId) form.append('repairOrderId', meta.repairOrderId);
    if (meta.repairLineId) form.append('repairLineId', meta.repairLineId);
    for (const [i, frame] of frames.slice(0, 8).entries()) {
      form.append('frames', frame, `frame-${i}.jpg`);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < VIDEO_CHUNK_CLIENT_RETRIES; attempt++) {
      try {
        const { res, body } = await fetchJsonWithTimeout<{ inspection: VideoInspectionDetail }>(
          '/api/video-inspections/upload',
          { method: 'POST', body: form },
          VIDEO_UPLOAD_SINGLE_TIMEOUT_MS,
          signal
        );
        assertOk(res, body, 'Upload failed');
        if (!body.inspection?.id) {
          throw new Error(body.error || 'Upload completed but no inspection was returned');
        }
        onProgress?.({
          phase: 'done',
          chunksTotal: 1,
          chunksSent: 1,
          percent: 100,
          message: 'Upload complete',
          bytesSent: totalBytes,
          bytesTotal: totalBytes,
        });
        return { inspection: body.inspection };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        lastError = error instanceof Error ? error : new Error('Upload failed');
        const retriable =
          error instanceof UploadHttpError
            ? error.retriable
            : /timeout|network|fetch|failed to fetch|offline|temporar|503|502|504|429/i.test(
                lastError.message
              );
        if (!retriable || attempt >= VIDEO_CHUNK_CLIENT_RETRIES - 1) break;
        onProgress?.({
          phase: 'complete',
          chunksTotal: 1,
          chunksSent: 0,
          percent: 8,
          message: `Retrying upload (${attempt + 1})…`,
          bytesTotal: totalBytes,
        });
        await sleep(Math.min(10_000, 700 * Math.pow(1.6, attempt)));
      }
    }
    throw lastError || new Error('Upload failed');
  }

  // ─── Chunked / resumable path ─────────────────────────────────────────────
  onProgress?.({
    phase: 'init',
    chunksTotal: totalChunks,
    chunksSent: 0,
    percent: 2,
    message: 'Starting secure upload…',
    bytesSent: 0,
    bytesTotal: totalBytes,
  });

  let initBody: {
    sessionId?: string;
    chunkBytes?: number;
    totalChunks?: number;
    received?: number[];
    error?: string;
  } = {};
  let initRes: Response | null = null;
  let initError: Error | null = null;

  for (let attempt = 0; attempt < VIDEO_CHUNK_CLIENT_RETRIES; attempt++) {
    try {
      const result = await fetchJsonWithTimeout<{
        sessionId: string;
        chunkBytes: number;
        totalChunks: number;
        received: number[];
      }>(
        '/api/video-inspections/upload/init',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentType,
            totalBytes,
            totalChunks,
            meta: {
              title: meta.title || 'Video inspection',
              vehicleLabel: meta.vehicleLabel || '',
              customerName: meta.customerName || '',
              customerPhone: meta.customerPhone || '',
              vin: meta.vin || '',
              transcript: meta.transcript || '',
              transcriptLanguage: meta.transcriptLanguage || 'en',
              recordingMode: meta.recordingMode || 'standard',
              durationSec: meta.durationSec ?? null,
              repairOrderId: meta.repairOrderId || null,
              repairLineId: meta.repairLineId || null,
            },
          }),
        },
        VIDEO_UPLOAD_INIT_TIMEOUT_MS,
        signal
      );
      initRes = result.res;
      initBody = result.body;
      if (!result.res.ok) {
        throw new UploadHttpError(
          result.body.error || 'Could not start upload session',
          result.res.status,
          isRetriableStatus(result.res.status)
        );
      }
      initError = null;
      break;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      initError = error instanceof Error ? error : new Error('Could not start upload session');
      const retriable =
        error instanceof UploadHttpError
          ? error.retriable
          : /timeout|network|fetch|failed to fetch|offline|temporar|503|502|504|429/i.test(
              initError.message
            );
      if (!retriable || attempt >= VIDEO_CHUNK_CLIENT_RETRIES - 1) break;
      onProgress?.({
        phase: 'init',
        chunksTotal: totalChunks,
        chunksSent: 0,
        percent: 2,
        message: `Retrying upload start (${attempt + 1})…`,
        bytesTotal: totalBytes,
      });
      await sleep(Math.min(8_000, 500 * Math.pow(1.6, attempt)));
    }
  }

  if (initError || !initRes?.ok || !initBody.sessionId) {
    throw initError || new Error(initBody.error || 'Could not start upload session');
  }

  const sessionId = initBody.sessionId;
  const chunkBytes = initBody.chunkBytes || VIDEO_UPLOAD_CHUNK_BYTES;
  const already = new Set(initBody.received || []);
  let sent = already.size;
  let bytesSent = sent * chunkBytes;
  if (bytesSent > totalBytes) bytesSent = totalBytes;

  onProgress?.({
    phase: 'chunk',
    chunksTotal: totalChunks,
    chunksSent: sent,
    percent: percentForChunks(sent, totalChunks, 'chunk'),
    message:
      sent > 0
        ? `Resuming upload (${sent}/${totalChunks} chunks already saved)…`
        : `Uploading chunk 1 of ${totalChunks}…`,
    bytesSent,
    bytesTotal: totalBytes,
  });

  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

    if (already.has(i)) {
      continue;
    }

    const start = i * chunkBytes;
    const end = Math.min(totalBytes, start + chunkBytes);
    const chunk = video.slice(start, end);

    // Advance progress *before* the network call so UI never freezes at 2%.
    onProgress?.({
      phase: 'chunk',
      chunksTotal: totalChunks,
      chunksSent: sent,
      percent: percentForChunks(sent, totalChunks, 'chunk'),
      message: `Uploading chunk ${i + 1} of ${totalChunks}…`,
      bytesSent,
      bytesTotal: totalBytes,
    });

    await putChunkWithRetry(sessionId, i, totalChunks, chunk, signal, (attempt, message) => {
      onProgress?.({
        phase: 'chunk',
        chunksTotal: totalChunks,
        chunksSent: sent,
        percent: percentForChunks(sent, totalChunks, 'chunk'),
        message: `Retrying chunk ${i + 1} (attempt ${attempt})… ${message.slice(0, 80)}`,
        bytesSent,
        bytesTotal: totalBytes,
      });
    });

    sent += 1;
    bytesSent = Math.min(totalBytes, bytesSent + (end - start));
    onProgress?.({
      phase: 'chunk',
      chunksTotal: totalChunks,
      chunksSent: sent,
      percent: percentForChunks(sent, totalChunks, 'chunk'),
      message: `Uploaded ${sent} of ${totalChunks} chunks`,
      bytesSent,
      bytesTotal: totalBytes,
    });
  }

  onProgress?.({
    phase: 'complete',
    chunksTotal: totalChunks,
    chunksSent: sent,
    percent: 92,
    message: 'Assembling video on server…',
    bytesSent: totalBytes,
    bytesTotal: totalBytes,
  });

  const completeForm = new FormData();
  completeForm.append('sessionId', sessionId);
  for (const [i, frame] of frames.slice(0, 8).entries()) {
    completeForm.append('frames', frame, `frame-${i}.jpg`);
  }

  let completeError: Error | null = null;
  for (let attempt = 0; attempt < VIDEO_CHUNK_CLIENT_RETRIES; attempt++) {
    try {
      const { res: completeRes, body: completeBody } = await fetchJsonWithTimeout<{
        inspection: VideoInspectionDetail;
      }>(
        '/api/video-inspections/upload/complete',
        { method: 'POST', body: completeForm },
        VIDEO_UPLOAD_COMPLETE_TIMEOUT_MS,
        signal
      );
      assertOk(completeRes, completeBody, 'Could not finalize upload');
      if (!completeBody.inspection?.id) {
        throw new Error(completeBody.error || 'Upload completed but no inspection was returned');
      }
      onProgress?.({
        phase: 'done',
        chunksTotal: totalChunks,
        chunksSent: sent,
        percent: 100,
        message: 'Upload complete',
        bytesSent: totalBytes,
        bytesTotal: totalBytes,
      });
      return { inspection: completeBody.inspection };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      completeError = error instanceof Error ? error : new Error('Could not finalize upload');
      // 409 already complete is not expected on first success path
      const retriable =
        error instanceof UploadHttpError
          ? error.retriable
          : /timeout|network|fetch|failed to fetch|offline|temporar|503|502|504|429|assembl/i.test(
              completeError.message
            );
      if (!retriable || attempt >= VIDEO_CHUNK_CLIENT_RETRIES - 1) break;
      onProgress?.({
        phase: 'complete',
        chunksTotal: totalChunks,
        chunksSent: sent,
        percent: 92,
        message: `Retrying finalize (${attempt + 1})…`,
        bytesSent: totalBytes,
        bytesTotal: totalBytes,
      });
      await sleep(Math.min(10_000, 800 * Math.pow(1.6, attempt)));
    }
  }

  throw completeError || new Error('Could not finalize upload');
}
