import { PAYLOAD_TOO_LARGE_ERROR, VALIDATION_ERROR, apiError } from './errors';
import type { NextResponse } from 'next/server';

/** Default JSON body cap for authenticated API routes (1 MB). */
export const DEFAULT_JSON_BODY_LIMIT_BYTES = 1_048_576;

/** Larger cap for routes that accept image metadata arrays. */
export const LARGE_JSON_BODY_LIMIT_BYTES = 2_097_152;

/**
 * Reads and parses JSON with a byte-size guard.
 * Prevents oversized payloads from exhausting serverless memory on tablets uploading scan metadata.
 */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_JSON_BODY_LIMIT_BYTES
): Promise<{ body: unknown } | { error: NextResponse }> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    return { error: apiError(PAYLOAD_TOO_LARGE_ERROR, 413) };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { error: apiError(VALIDATION_ERROR, 400) };
  }

  if (raw.length > maxBytes) {
    return { error: apiError(PAYLOAD_TOO_LARGE_ERROR, 413) };
  }

  if (!raw.trim()) {
    return { body: {} };
  }

  try {
    return { body: JSON.parse(raw) as unknown };
  } catch {
    return { error: apiError(VALIDATION_ERROR, 400) };
  }
}