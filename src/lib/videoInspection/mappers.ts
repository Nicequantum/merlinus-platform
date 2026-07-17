import { decryptSensitiveText } from '@/lib/encryption';

export type VideoInspectionRow = {
  id: string;
  dealershipId: string;
  technicianId: string;
  repairOrderId: string | null;
  repairLineId: string | null;
  status: string;
  videoPathname: string;
  contentType: string;
  sizeBytes: number;
  durationSec: number | null;
  thumbnailPathname: string | null;
  framePathnames: string;
  transcriptEncrypted: string;
  transcriptLanguage: string;
  reportEncrypted: string;
  reportPromptVersion: string;
  vehicleLabel: string | null;
  title: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  technician?: { name: string } | null;
  dealership?: { name: string } | null;
};

export function parseFramePathnames(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string' && p.length > 0);
  } catch {
    return [];
  }
}

export function mapVideoInspectionListItem(row: VideoInspectionRow) {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    vehicleLabel: row.vehicleLabel,
    transcriptLanguage: row.transcriptLanguage,
    hasVideo: Boolean(row.videoPathname),
    hasReport: Boolean(row.reportEncrypted?.trim()),
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    technicianName: row.technician?.name ?? null,
    dealershipName: row.dealership?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    errorMessage: row.errorMessage,
  };
}

export function mapVideoInspectionDetail(row: VideoInspectionRow, options?: { includeMediaUrls?: boolean }) {
  const frames = parseFramePathnames(row.framePathnames);
  return {
    ...mapVideoInspectionListItem(row),
    contentType: row.contentType,
    videoPathname: row.videoPathname || null,
    mediaUrl: options?.includeMediaUrls && row.videoPathname
      ? `/api/video-inspections/${row.id}/media`
      : null,
    thumbnailUrl: null as string | null,
    frameCount: frames.length,
    transcript: decryptSensitiveText(row.transcriptEncrypted || ''),
    report: decryptSensitiveText(row.reportEncrypted || ''),
    reportPromptVersion: row.reportPromptVersion || null,
    repairOrderId: row.repairOrderId,
    repairLineId: row.repairLineId,
  };
}
