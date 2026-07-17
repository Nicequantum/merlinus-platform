import { decryptSensitiveText } from '@/lib/encryption';
import {
  mapFindingDto,
  type FindingDto,
  type FindingRow,
} from '@/lib/videoInspection/findings';
import { parseSeveritySummary } from '@/lib/videoInspection/mpiCategories';

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
  customerNameEncrypted?: string;
  customerPhoneEncrypted?: string;
  customerPhoneLast4?: string;
  vinEncrypted?: string;
  vinLast8?: string | null;
  mpiChecklistJson?: string;
  severitySummary?: string | null;
  recordingMode?: string;
  deliveryChannel?: string | null;
  deliveredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  technician?: { name: string } | null;
  dealership?: { name: string } | null;
  findings?: FindingRow[];
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
  const severityCounts = parseSeveritySummary(row.severitySummary);
  const findingCount =
    row.findings?.length ??
    severityCounts.ok + severityCounts.recommend + severityCounts.urgent;

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
    // PR-M1a status board fields
    vinLast8: row.vinLast8 ?? null,
    customerPhoneLast4: row.customerPhoneLast4 || null,
    severitySummary: row.severitySummary ?? null,
    severityCounts,
    findingCount,
    recordingMode: row.recordingMode || 'standard',
    deliveryChannel: row.deliveryChannel ?? null,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
  };
}

export function mapVideoInspectionDetail(
  row: VideoInspectionRow,
  options?: { includeMediaUrls?: boolean }
) {
  const frames = parseFramePathnames(row.framePathnames);
  const findings: FindingDto[] = (row.findings ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(mapFindingDto);

  const customerName = decryptSensitiveText(row.customerNameEncrypted || '');
  const customerPhone = decryptSensitiveText(row.customerPhoneEncrypted || '');
  const vin = decryptSensitiveText(row.vinEncrypted || '');

  return {
    ...mapVideoInspectionListItem(row),
    contentType: row.contentType,
    videoPathname: row.videoPathname || null,
    mediaUrl:
      options?.includeMediaUrls && row.videoPathname
        ? `/api/video-inspections/${row.id}/media`
        : null,
    thumbnailUrl: null as string | null,
    frameCount: frames.length,
    transcript: decryptSensitiveText(row.transcriptEncrypted || ''),
    report: decryptSensitiveText(row.reportEncrypted || ''),
    reportPromptVersion: row.reportPromptVersion || null,
    repairOrderId: row.repairOrderId,
    repairLineId: row.repairLineId,
    customerName,
    customerPhone,
    vin,
    mpiChecklistJson: row.mpiChecklistJson || '[]',
    findings,
  };
}
