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
  mergeVideoFieldsWithRoPrefill,
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
  deleteVideoChunksBestEffort,
  assembleVideoChunksToBlob,
  uploadVideoFrameToBlob,
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
 * Assemble chunked upload into final VideoInspection (video_mpi).
 * Tenant-scoped: dealershipId + technician ownership on session row.
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

      // Idempotent: if already complete, return the linked inspection when possible
      if (uploadSession.status === 'complete') {
        return apiError('Upload session already completed — refresh the list', 409);
      }
      if (uploadSession.expiresAt.getTime() < Date.now()) {
        const pathnames = parseJsonArray(uploadSession.chunkPathnames).filter(Boolean);
        await deleteVideoChunksBestEffort(pathnames);
        await db.videoUploadSession.updateMany({
          where: {
            id: uploadSession.id,
            dealershipId,
            technicianId: session.technicianId,
          },
          data: { status: 'abandoned', errorMessage: 'Session expired' },
        });
        return apiError('Upload session expired — please save again', 410);
      }
      // Allow retry if a previous assemble crashed mid-flight
      if (uploadSession.status !== 'pending' && uploadSession.status !== 'assembling' && uploadSession.status !== 'failed') {
        return apiError(`Upload session is ${uploadSession.status}`, 409);
      }

      const received = parseReceivedMask(uploadSession.receivedMask);
      if (received.length < uploadSession.totalChunks) {
        return apiError(
          `Missing chunks (${received.length}/${uploadSession.totalChunks}). Wait for all chunks or retry Save.`,
          400
        );
      }

      const pathnames = parseJsonArray(uploadSession.chunkPathnames);
      if (pathnames.length < uploadSession.totalChunks || pathnames.some((p) => !p)) {
        return apiError('Chunk storage incomplete — retry Save', 400);
      }

      // updateMany required under RLS (unique update where cannot be AND-wrapped)
      await db.videoUploadSession.updateMany({
        where: {
          id: uploadSession.id,
          dealershipId,
          technicianId: session.technicianId,
        },
        data: { status: 'assembling', errorMessage: null },
      });

      let assembled: { pathname: string; sizeBytes: number };
      try {
        // Multipart assemble when available — avoids OOM on 10–20 min walkarounds.
        const contentType = uploadSession.contentType || 'video/webm';
        const ext = contentType.includes('mp4') ? 'mp4' : 'webm';
        assembled = await assembleVideoChunksToBlob(
          pathnames.filter(Boolean),
          `inspection.${ext}`,
          contentType,
          dealershipId
        );
      } catch (error) {
        await db.videoUploadSession.updateMany({
          where: {
            id: uploadSession.id,
            dealershipId,
            technicianId: session.technicianId,
          },
          data: {
            status: 'failed',
            errorMessage:
              error instanceof Error ? error.message.slice(0, 500) : 'Assemble failed',
          },
        });
        const mapped = mapBlobRouteError(error, 'upload');
        return reportMappedRouteError(mapped, error, 'video.upload.complete');
      }

      if (assembled.sizeBytes <= 0) {
        await deleteVideoChunksBestEffort(pathnames.filter(Boolean));
        return apiError('Assembled video is empty', 400);
      }

      const meta = parseUploadMeta(uploadSession.metaJson);
      const maxDurationSec = getVideoMaxDurationSec();
      let durationSec =
        typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec)
          ? meta.durationSec
          : null;
      if (durationSec !== null && durationSec > maxDurationSec) {
        await deleteVideoChunksBestEffort(pathnames.filter(Boolean));
        // Soft message — defaults are now 2h; only fails if env is intentionally low.
        return apiError(
          `Video exceeds max duration (${Math.floor(maxDurationSec / 60)} min). Contact your manager if you need a longer cap.`,
          400
        );
      }

      const contentType = uploadSession.contentType || 'video/webm';
      const sizeBytes = assembled.sizeBytes;
      const uploaded = { pathname: assembled.pathname, url: '' };

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
      const transcript = (meta.transcript || '').slice(0, 20_000);
      const transcriptLanguage = normalizePreferredLanguage(
        meta.transcriptLanguage || session.preferredLanguage || 'en'
      );
      const recordingMode =
        meta.recordingMode === 'fullscreen' || meta.recordingMode === 'upload'
          ? meta.recordingMode
          : 'standard';

      let link;
      try {
        link = await resolveRepairOrderLink(
          session,
          meta.repairOrderId,
          meta.repairLineId
        );
      } catch (error) {
        return apiError(error instanceof Error ? error.message : 'Invalid repair order', 400);
      }

      const prefilled = mergeVideoFieldsWithRoPrefill(
        {
          vehicleLabel: meta.vehicleLabel,
          customerName: meta.customerName,
          customerPhone: meta.customerPhone,
          vin: meta.vin,
        },
        link
      );
      const vehicleLabel = prefilled.vehicleLabel?.slice(0, 200) || null;
      const customerName = prefilled.customerName.slice(0, 200);
      const customerPhone = prefilled.customerPhone.slice(0, 40);
      const vin = prefilled.vin.slice(0, 32);

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
          sizeBytes,
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

      await db.videoUploadSession.updateMany({
        where: {
          id: uploadSession.id,
          dealershipId,
          technicianId: session.technicianId,
        },
        data: { status: 'complete', errorMessage: null },
      });

      // Cleanup temporary chunk parts — avoid multi-tenant R2 orphan growth
      await deleteVideoChunksBestEffort(pathnames.filter(Boolean));

      await writeAuditedAccess({
        action: 'video.upload',
        dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'video_inspection',
        entityId: row.id,
        metadata: {
          pathname: uploaded.pathname,
          size: sizeBytes,
          frameCount: framePathnames.length,
          chunked: true,
          uploadSessionId: uploadSession.id,
          repairOrderId: link.repairOrderId,
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

export const maxDuration = 600;
