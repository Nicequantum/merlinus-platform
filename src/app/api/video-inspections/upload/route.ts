import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, reportMappedRouteError } from '@/lib/errors';
import { normalizePreferredLanguage } from '@/lib/i18n/locales';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { mapBlobRouteError } from '@/lib/scanRouteErrors';
import { getVideoMaxBytes, getVideoMaxDurationSec } from '@/lib/videoInspection/shareTokens';
import { mapVideoInspectionDetail } from '@/lib/videoInspection/mappers';
import { uploadVideoFrameToBlob, uploadVideoToBlob } from '@/lib/videoBlob';

const ALLOWED_VIDEO_TYPES = new Set([
  'video/webm',
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
]);

const ALLOWED_FRAME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/** Cap spoken/typed transcript on upload (align with PATCH). */
const MAX_TRANSCRIPT_CHARS = 20_000;

/** Multipart overhead allowance on top of max video bytes. */
const MULTIPART_OVERHEAD_BYTES = 8 * 1024 * 1024;

type UploadFile = {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function isUploadFile(value: unknown): value is UploadFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof (value as UploadFile).arrayBuffer === 'function' &&
    'name' in value &&
    'type' in value &&
    'size' in value
  );
}

function resolveVideoType(file: UploadFile): string | null {
  if (ALLOWED_VIDEO_TYPES.has(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  return null;
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const maxBytes = getVideoMaxBytes();
      const maxDurationSec = getVideoMaxDurationSec();

      // Early reject oversized bodies before buffering formData (DoS mitigation).
      const contentLengthHeader = request.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (Number.isFinite(contentLength) && contentLength > maxBytes + MULTIPART_OVERHEAD_BYTES) {
          return apiError(
            `Upload too large (max ${Math.floor(maxBytes / (1024 * 1024))} MB video).`,
            413
          );
        }
      }

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return apiError('Invalid multipart body', 400);
      }

      const file = form.get('file');
      if (!isUploadFile(file)) {
        return apiError('Video file is required', 400);
      }

      const contentType = resolveVideoType(file);
      if (!contentType) {
        return apiError('Unsupported video type. Use WebM or MP4.', 400);
      }

      if (file.size > maxBytes) {
        return apiError(`Video exceeds max size (${Math.floor(maxBytes / (1024 * 1024))} MB)`, 400);
      }

      const title = String(form.get('title') || 'Video inspection').slice(0, 200);
      const vehicleLabel = String(form.get('vehicleLabel') || '').slice(0, 200) || null;
      const transcript = String(form.get('transcript') || '').slice(0, MAX_TRANSCRIPT_CHARS);
      const transcriptLanguage = normalizePreferredLanguage(
        form.get('transcriptLanguage') || session.preferredLanguage || 'en'
      );
      const durationRaw = Number(form.get('durationSec'));
      let durationSec: number | null =
        Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null;
      if (durationSec !== null && durationSec > maxDurationSec) {
        return apiError(`Video exceeds max duration (${maxDurationSec}s).`, 400);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      let uploaded;
      try {
        uploaded = await uploadVideoToBlob(
          buffer,
          file.name || 'inspection.webm',
          contentType,
          session.dealershipId
        );
      } catch (error) {
        const mapped = mapBlobRouteError(error, 'upload');
        return reportMappedRouteError(mapped, error, 'video.upload');
      }

      const framePathnames: string[] = [];
      const frameEntries = form.getAll('frames');
      for (const entry of frameEntries.slice(0, 8)) {
        if (!isUploadFile(entry)) continue;
        if (!ALLOWED_FRAME_TYPES.has(entry.type) && !entry.name.match(/\.(jpe?g|png|webp)$/i)) {
          continue;
        }
        if (entry.size > 2 * 1024 * 1024) continue;
        try {
          const frameBuf = Buffer.from(await entry.arrayBuffer());
          const frame = await uploadVideoFrameToBlob(
            frameBuf,
            entry.name || 'frame.jpg',
            entry.type || 'image/jpeg',
            session.dealershipId
          );
          framePathnames.push(frame.pathname);
        } catch {
          // skip failed frames
        }
      }

      const dealerId = resolveDealerIdForWrite({ session });
      const row = await getRlsDb().videoInspection.create({
        data: {
          dealershipId: session.dealershipId,
          dealerId: dealerId ?? null,
          technicianId: session.technicianId,
          title,
          vehicleLabel,
          status: 'draft',
          videoPathname: uploaded.pathname,
          contentType,
          sizeBytes: file.size,
          durationSec,
          framePathnames: JSON.stringify(framePathnames),
          transcriptEncrypted: encryptSensitiveText(transcript),
          transcriptLanguage,
        },
        include: {
          technician: { select: { name: true } },
          dealership: { select: { name: true } },
        },
      });

      await writeAuditedAccess({
        action: 'video.upload',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'video_inspection',
        entityId: row.id,
        metadata: {
          pathname: uploaded.pathname,
          size: file.size,
          frameCount: framePathnames.length,
        },
        ipAddress: getRequestIp(request),
      });

      return { inspection: mapVideoInspectionDetail(row, { includeMediaUrls: true }) };
    },
    {
      rateLimitKey: 'video.upload',
      rateLimit: RATE_LIMITS.videoUpload,
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}

export const maxDuration = 180;
