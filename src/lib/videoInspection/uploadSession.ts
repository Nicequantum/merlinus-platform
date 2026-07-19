/**
 * PR-M1b — server helpers for VideoUploadSession JSON fields.
 */

export type UploadSessionMeta = {
  title?: string;
  vehicleLabel?: string;
  customerName?: string;
  customerPhone?: string;
  vin?: string;
  transcript?: string;
  transcriptLanguage?: string;
  recordingMode?: string;
  durationSec?: number | null;
  repairOrderId?: string | null;
  repairLineId?: string | null;
};

export function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v));
  } catch {
    return [];
  }
}

export function parseReceivedMask(raw: string | null | undefined): number[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0);
  } catch {
    return [];
  }
}

export function parseUploadMeta(raw: string | null | undefined): UploadSessionMeta {
  try {
    const parsed = JSON.parse(raw || '{}') as UploadSessionMeta;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function ensurePathnamesArray(totalChunks: number, existing: string[]): string[] {
  const next = existing.slice(0, totalChunks);
  while (next.length < totalChunks) next.push('');
  return next;
}
