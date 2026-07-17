/**
 * PR-M1b — client orchestration for chunked/resumable Video MPI uploads.
 */

import {
  VIDEO_CHUNK_CLIENT_RETRIES,
  VIDEO_UPLOAD_CHUNK_BYTES,
  computeChunkCount,
} from '@/lib/videoInspection/uploadConstants';
import type { PendingVideoUploadMeta } from '@/lib/videoInspection/offlineQueue';
import type { VideoInspectionDetail } from '@/types';

export type UploadProgress = {
  phase: 'init' | 'chunk' | 'complete' | 'done';
  chunksTotal: number;
  chunksSent: number;
  percent: number;
  message?: string;
};

export interface ChunkedUploadInput {
  video: Blob;
  frames?: Blob[];
  meta: PendingVideoUploadMeta & { title?: string };
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

function assertOk(res: Response, body: { error?: string }, fallback: string): void {
  if (!res.ok) {
    throw new Error(body.error || fallback);
  }
}

async function fetchJson<T>(
  path: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<{ res: Response; body: T & { error?: string } }> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { res, body };
}

async function putChunkWithRetry(
  sessionId: string,
  index: number,
  totalChunks: number,
  chunk: Blob,
  signal?: AbortSignal
): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < VIDEO_CHUNK_CLIENT_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const form = new FormData();
      form.append('sessionId', sessionId);
      form.append('chunkIndex', String(index));
      form.append('totalChunks', String(totalChunks));
      form.append('chunk', chunk, `chunk-${index}.part`);
      const { res, body } = await fetchJson<{ ok?: boolean }>('/api/video-inspections/upload/chunk', {
        method: 'POST',
        body: form,
      }, signal);
      assertOk(res, body, `Chunk ${index + 1} failed`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Chunk upload failed');
      if (attempt < VIDEO_CHUNK_CLIENT_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error('Chunk upload failed');
}

/**
 * Prefer chunked upload for reliability; falls back to single multipart when tiny.
 */
export async function uploadVideoInspectionResumable(
  input: ChunkedUploadInput
): Promise<{ inspection: VideoInspectionDetail }> {
  const { video, frames = [], meta, onProgress, signal } = input;
  const totalBytes = video.size;
  const totalChunks = Math.max(1, computeChunkCount(totalBytes, VIDEO_UPLOAD_CHUNK_BYTES));

  // Small files: single-shot existing endpoint (still used for frames convenience)
  if (totalBytes > 0 && totalBytes <= VIDEO_UPLOAD_CHUNK_BYTES) {
    onProgress?.({
      phase: 'complete',
      chunksTotal: 1,
      chunksSent: 0,
      percent: 10,
      message: 'Uploading…',
    });
    const form = new FormData();
    const ext = video.type.includes('mp4') ? 'mp4' : 'webm';
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
    for (const [i, frame] of frames.slice(0, 8).entries()) {
      form.append('frames', frame, `frame-${i}.jpg`);
    }
    const { res, body } = await fetchJson<{ inspection: VideoInspectionDetail }>(
      '/api/video-inspections/upload',
      { method: 'POST', body: form },
      signal
    );
    assertOk(res, body, 'Upload failed');
    onProgress?.({
      phase: 'done',
      chunksTotal: 1,
      chunksSent: 1,
      percent: 100,
    });
    return { inspection: body.inspection };
  }

  onProgress?.({
    phase: 'init',
    chunksTotal: totalChunks,
    chunksSent: 0,
    percent: 2,
    message: 'Starting resumable upload…',
  });

  const { res: initRes, body: initBody } = await fetchJson<{
    sessionId: string;
    chunkBytes: number;
    totalChunks: number;
    received: number[];
  }>('/api/video-inspections/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentType: video.type || 'video/webm',
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
      },
    }),
  }, signal);
  assertOk(initRes, initBody, 'Could not start upload session');

  const sessionId = initBody.sessionId;
  const already = new Set(initBody.received || []);
  let sent = already.size;

  for (let i = 0; i < totalChunks; i++) {
    if (already.has(i)) {
      onProgress?.({
        phase: 'chunk',
        chunksTotal: totalChunks,
        chunksSent: sent,
        percent: Math.round((sent / totalChunks) * 85) + 5,
      });
      continue;
    }
    const start = i * VIDEO_UPLOAD_CHUNK_BYTES;
    const end = Math.min(totalBytes, start + VIDEO_UPLOAD_CHUNK_BYTES);
    const chunk = video.slice(start, end);
    await putChunkWithRetry(sessionId, i, totalChunks, chunk, signal);
    sent += 1;
    onProgress?.({
      phase: 'chunk',
      chunksTotal: totalChunks,
      chunksSent: sent,
      percent: Math.round((sent / totalChunks) * 85) + 5,
      message: `Uploading chunk ${sent}/${totalChunks}`,
    });
  }

  onProgress?.({
    phase: 'complete',
    chunksTotal: totalChunks,
    chunksSent: sent,
    percent: 92,
    message: 'Assembling video…',
  });

  const completeForm = new FormData();
  completeForm.append('sessionId', sessionId);
  for (const [i, frame] of frames.slice(0, 8).entries()) {
    completeForm.append('frames', frame, `frame-${i}.jpg`);
  }

  const { res: completeRes, body: completeBody } = await fetchJson<{
    inspection: VideoInspectionDetail;
  }>('/api/video-inspections/upload/complete', {
    method: 'POST',
    body: completeForm,
  }, signal);
  assertOk(completeRes, completeBody, 'Could not finalize upload');

  onProgress?.({
    phase: 'done',
    chunksTotal: totalChunks,
    chunksSent: sent,
    percent: 100,
  });

  return { inspection: completeBody.inspection };
}
