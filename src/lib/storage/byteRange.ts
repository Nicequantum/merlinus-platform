/**
 * HTTP byte-range parsing (pure — no storage bindings).
 */

export type ByteRangeRequest =
  | { kind: 'full' }
  | { kind: 'suffix'; length: number }
  | { kind: 'bounded'; start: number; end: number };

/** Parse a single HTTP Range header for bytes (first range only). */
export function parseBytesRangeHeader(
  header: string | null | undefined,
  totalSize: number
): ByteRangeRequest | 'unsatisfiable' {
  if (!header || totalSize <= 0) return { kind: 'full' };
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!m) return { kind: 'full' };
  const startRaw = m[1];
  const endRaw = m[2];
  if (startRaw === '' && endRaw === '') return { kind: 'full' };
  if (startRaw === '') {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    return { kind: 'suffix', length: Math.min(Math.floor(suffix), totalSize) };
  }
  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) return 'unsatisfiable';
  const end =
    endRaw === ''
      ? totalSize - 1
      : Math.min(Number(endRaw), totalSize - 1);
  if (!Number.isFinite(end) || end < start) return 'unsatisfiable';
  return { kind: 'bounded', start: Math.floor(start), end: Math.floor(end) };
}
