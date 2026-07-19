import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, reportMappedRouteError } from '@/lib/errors';
import { normalizePreferredLanguage } from '@/lib/i18n/locales';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { mapBlobRouteError } from '@/lib/scanRouteErrors';
import {
  inspectionInclude,
  resolveRepairOrderLink,
  resolveVideoDealershipId,
} from '@/lib/videoInspection/access';
import { last8OfVin, phoneLast4 } from '@/lib/videoInspection/mpiCategories';
import { getVideoMaxDurationSec } from '@/lib/videoInspection/shareTokens';
import {
  parseJsonArray,
  parseReceivedMask,
  parseUploadMeta,
} from '@/lib/videoInspection/uploadSession';
import { mapVideoInspectionDetail } from '@/lib/videoInspection/mappers';
import {
  fetchPrivateVideoChunkAsBuffer,
  uploadVideoFrameToBlob,
  uploadVideoToBlob,
} from '@/lib/videoBlob';

const ALLOWED_FRAME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

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

/**
 * PR-M1b — assemble chunked upload into final VideoInspection (video_mpi).
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return apiError('Invalid multipart body', 400);
      }

      const sessionId = String(form.get('sessionId') || '').trim();
      if (!sessionId) return apiError('sessionId is required', 400);

      const db = getRlsDb();
      const dealershipId = resolveVideoDealershipId(session);
      const uploadSession = await db.videoUploadSession.findFirst({
        where: {
          id: sessionId,
          dealershipId,
          technicianId: session.technicianId,
        },
      });
      if (!uploadSession) return apiError('Upload session not found', 404);
      if (uploadSession.status === 'complete') {
        return apiError('Upload session already completed', 409);
      }
      if (uploadSession.expiresAt.getTime() < Date.now()) {
        await db.videoUploadSession.update({
          where: { id: uploadSession.id },
          data: { status: 'abandoned', errorMessage: 'Session expired' },
        });
        return apiError('Upload session expired', 410);
      }

      const received = parseReceivedMask(uploadSession.receivedMask);
      if (received.length < uploadSession.totalChunks) {
        return apiError(
          `Missing chunks (${received.length}/${uploadSession.totalChunks})`,
          400
        );
      }

      const pathnames = parseJsonArray(uploadSession.chunkPathnames);
      if (pathnames.length < uploadSession.totalChunks || pathnames.some((p) => !p)) {
        return apiError('Chunk storage incomplete', 400);
      }

      await db.videoUploadSession.update({
        where: { id: uploadSession.id },
        data: { status: 'assembling' },
      });

      let assembled: Buffer;
      try {
        const parts: Buffer[] = [];
        for (let i = 0; i < uploadSession.totalChunks; i++) {
          const path = pathnames[i]!;
          parts.push(await fetchPrivateVideoChunkAsBuffer(path));
        }
        assembled = Buffer.concat(parts);
      } catch (error) {
        await db.videoUploadSession.update({
          where: { id: uploadSession.id },
          data: {
            status: 'failed',
            errorMessage:
              error instanceof Error ? error.message.slice(0, 500) : 'Assemble failed',
          },
        });
        const mapped = mapBlobRouteError(error, 'upload');
        return reportMappedRouteError(mapped, error, 'video.upload.complete');
      }

      if (assembled.byteLength <= 0) {
        return apiError('Assembled video is empty', 400);
      }

      const meta = parseUploadMeta(uploadSession.metaJson);
      const maxDurationSec = getVideoMaxDurationSec();
      let durationSec =
        typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec)
          ? meta.durationSec
          : null;
      if (durationSec !== null && durationSec > maxDurationSec) {
        return apiError(`Video exceeds max duration (${maxDurationSec}s).`, 400);
      }

      const contentType = uploadSession.contentType || 'video/webm';
      const ext = contentType.includes('mp4') ? 'mp4' : 'webm';

      let uploaded;
      try {
        uploaded = await uploadVideoToBlob(
          assembled,
          `inspection.${ext}`,
          contentType,
          dealershipId
        );
      } catch (error) {
        await db.videoUploadSession.update({
          where: { id: uploadSession.id },
          data: {
            status: 'failed',
            errorMessage:
              error instanceof Error ? error.message.slice(0, 500) : 'Final upload failed',
          },
        });
        const mapped = mapBlobRouteError(error, 'upload');
        return reportMappedRouteError(mapped, error, 'video.upload.complete');
      }

      const framePathnames: string[] = [];
      for (const entry of form.getAll('frames').slice(0, 8)) {
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
            dealershipId
          );
          framePathnames.push(frame.pathname);
        } catch {
          // skip failed frames
        }
      }

      const title = (meta.title || 'Video inspection').slice(0, 200);
      const vehicleLabel = (meta.vehicleLabel || '').slice(0, 200) || null;
      const customerName = (meta.customerName || '').slice(0, 200);
      const customerPhone = (meta.customerPhone || '').slice(0, 40);
      const vin = (meta.vin || '').trim().toUpperCase().slice(0, 32);
      const transcript = (meta.transcript || '').slice(0, 20_000);
      const transcriptLanguage = normalizePreferredLanguage(
        meta.transcriptLanguage || session.preferredLanguage || 'en'
      );
      const recordingMode =
        meta.recordingMode === 'fullscreen' || meta.recordingMode === 'upload'
          ? meta.recordingMode
          : 'standard';

      let link: { repairOrderId: string | null; repairLineId: string | null };
      try {
        link = await resolveRepairOrderLink(
          session,
          meta.repairOrderId,
          meta.repairLineId
        );
      } catch (error) {
        return apiError(error instanceof Error ? error.message : 'Invalid repair order', 400);
      }

      const row = await db.videoInspection.create({
        data: {
          dealershipId,
          dealerId: uploadSession.dealerId,
          technicianId: session.technicianId,
          title,
          vehicleLabel,
          status: 'draft',
          videoPathname: uploaded.pathname,
          contentType,
          sizeBytes: assembled.byteLength,
          durationSec,
          framePathnames: JSON.stringify(framePathnames),
          transcriptEncrypted: encryptSensitiveText(transcript),
          transcriptLanguage,
          recordingMode,
          customerNameEncrypted: encryptSensitiveText(customerName),
          customerPhoneEncrypted: encryptSensitiveText(customerPhone),
          customerPhoneLast4: phoneLast4(customerPhone),
          vinEncrypted: encryptSensitiveText(vin),
          vinLast8: last8OfVin(vin),
          repairOrderId: link.repairOrderId,
          repairLineId: link.repairLineId,
        },
        include: inspectionInclude,
      });

      await db.videoUploadSession.update({
        where: { id: uploadSession.id },
        data: { status: 'complete', errorMessage: null },
      });

      await writeAuditedAccess({
        action: 'video.upload',
        dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'video_inspection',
        entityId: row.id,
        metadata: {
          pathname: uploaded.pathname,
          size: assembled.byteLength,
          frameCount: framePathnames.length,
          chunked: true,
          uploadSessionId: uploadSession.id,
        },
        ipAddress: getRequestIp(request),
      });

      return { inspection: mapVideoInspectionDetail(row, { includeMediaUrls: true }) };
    },
    {
      rateLimitKey: 'video.upload.complete',
      rateLimit: RATE_LIMITS.videoUpload,
      requireDealershipContext: true,
      requireAuditedAccess: true,
      requireModule: 'video_mpi',
    }
  );
}

export const maxDuration = 180;
