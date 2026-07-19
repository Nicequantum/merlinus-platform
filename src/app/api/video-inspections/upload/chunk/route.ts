import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError, reportMappedRouteError } from '@/lib/errors';
import { mapBlobRouteError } from '@/lib/scanRouteErrors';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { resolveVideoDealershipId } from '@/lib/videoInspection/access';
import {
  ensurePathnamesArray,
  parseJsonArray,
  parseReceivedMask,
} from '@/lib/videoInspection/uploadSession';
import { VIDEO_UPLOAD_CHUNK_BYTES } from '@/lib/videoInspection/uploadConstants';
import { uploadVideoChunkToBlob } from '@/lib/videoBlob';

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
    'size' in value
  );
}

/**
 * PR-M1b — upload one chunk of a resumable video session (video_mpi).
 * Idempotent for the same sessionId + chunkIndex.
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
      const chunkIndex = Number(form.get('chunkIndex'));
      const chunk = form.get('chunk');

      if (!sessionId) return apiError('sessionId is required', 400);
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
        return apiError('chunkIndex is invalid', 400);
      }
      if (!isUploadFile(chunk)) return apiError('chunk file is required', 400);
      if (chunk.size <= 0 || chunk.size > VIDEO_UPLOAD_CHUNK_BYTES + 64 * 1024) {
        return apiError('chunk size out of range', 400);
      }

      const db = getRlsDb();
      const dealershipId = resolveVideoDealershipId(session);
      const row = await db.videoUploadSession.findFirst({
        where: {
          id: sessionId,
          dealershipId,
          technicianId: session.technicianId,
        },
      });
      if (!row) return apiError('Upload session not found', 404);
      if (row.status !== 'pending') {
        return apiError(`Upload session is ${row.status}`, 409);
      }
      if (row.expiresAt.getTime() < Date.now()) {
        await db.videoUploadSession.update({
          where: { id: row.id },
          data: { status: 'abandoned', errorMessage: 'Session expired' },
        });
        return apiError('Upload session expired', 410);
      }
      if (chunkIndex >= row.totalChunks) {
        return apiError('chunkIndex out of range', 400);
      }

      let uploaded;
      try {
        uploaded = await uploadVideoChunkToBlob(
          Buffer.from(await chunk.arrayBuffer()),
          dealershipId,
          row.id,
          chunkIndex
        );
      } catch (error) {
        const mapped = mapBlobRouteError(error, 'upload');
        return reportMappedRouteError(mapped, error, 'video.upload.chunk');
      }

      const received = new Set(parseReceivedMask(row.receivedMask));
      received.add(chunkIndex);
      const pathnames = ensurePathnamesArray(row.totalChunks, parseJsonArray(row.chunkPathnames));
      pathnames[chunkIndex] = uploaded.pathname;

      const receivedList = [...received].sort((a, b) => a - b);
      await db.videoUploadSession.update({
        where: { id: row.id },
        data: {
          receivedMask: JSON.stringify(receivedList),
          chunkPathnames: JSON.stringify(pathnames),
        },
      });

      return {
        ok: true,
        sessionId: row.id,
        chunkIndex,
        received: receivedList,
        complete: receivedList.length >= row.totalChunks,
      };
    },
    {
      rateLimitKey: 'video.upload.chunk',
      rateLimit: RATE_LIMITS.videoUpload,
      requireDealershipContext: true,
      requireModule: 'video_mpi',
    }
  );
}

export const maxDuration = 60;
