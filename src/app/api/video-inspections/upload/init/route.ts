import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { resolveVideoDealershipId } from '@/lib/videoInspection/access';
import {
  VIDEO_UPLOAD_CHUNK_BYTES,
  VIDEO_UPLOAD_MAX_CHUNKS,
  VIDEO_UPLOAD_SESSION_TTL_MS,
} from '@/lib/videoInspection/uploadConstants';
import { getVideoMaxBytes } from '@/lib/videoInspection/shareTokens';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

const initSchema = z.object({
  contentType: z.string().trim().min(3).max(80).default('video/webm'),
  totalBytes: z.number().int().positive(),
  totalChunks: z.number().int().positive().max(VIDEO_UPLOAD_MAX_CHUNKS),
  meta: z
    .object({
      title: z.string().max(200).optional(),
      vehicleLabel: z.string().max(200).optional(),
      customerName: z.string().max(200).optional(),
      customerPhone: z.string().max(40).optional(),
      vin: z.string().max(32).optional(),
      transcript: z.string().max(20_000).optional(),
      transcriptLanguage: z.string().max(16).optional(),
      recordingMode: z.enum(['fullscreen', 'standard', 'upload']).optional(),
      durationSec: z.number().finite().nullable().optional(),
      repairOrderId: z.string().max(64).nullable().optional(),
      repairLineId: z.string().max(64).nullable().optional(),
    })
    .optional(),
});

/**
 * PR-M1b — start a chunked/resumable upload session (video_mpi).
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, initSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const maxBytes = getVideoMaxBytes();
      if (parsed.data.totalBytes > maxBytes) {
        return apiError(
          `Video exceeds max size (${Math.floor(maxBytes / (1024 * 1024))} MB)`,
          400
        );
      }

      const expectedChunks = Math.ceil(parsed.data.totalBytes / VIDEO_UPLOAD_CHUNK_BYTES);
      if (parsed.data.totalChunks !== expectedChunks && parsed.data.totalChunks !== Math.max(1, expectedChunks)) {
        // Allow client off-by-one on empty edge; otherwise require match
        if (Math.abs(parsed.data.totalChunks - expectedChunks) > 1) {
          return apiError('totalChunks does not match totalBytes', 400);
        }
      }

      const dealerId = resolveDealerIdForWrite({ session });
      const dealershipId = resolveVideoDealershipId(session);
      const expiresAt = new Date(Date.now() + VIDEO_UPLOAD_SESSION_TTL_MS);
      const pathnames = Array.from({ length: parsed.data.totalChunks }, () => '');
      const rawType = (parsed.data.contentType || 'video/webm').split(';')[0]?.trim().toLowerCase() || 'video/webm';
      const contentType =
        rawType.includes('mp4') || rawType.includes('quicktime')
          ? rawType.includes('quicktime')
            ? 'video/quicktime'
            : 'video/mp4'
          : rawType.includes('webm')
            ? 'video/webm'
            : 'video/webm';

      const row = await getRlsDb().videoUploadSession.create({
        data: {
          dealershipId,
          technicianId: session.technicianId,
          dealerId: dealerId ?? null,
          contentType: contentType.slice(0, 80),
          totalBytes: parsed.data.totalBytes,
          totalChunks: parsed.data.totalChunks,
          receivedMask: '[]',
          chunkPathnames: JSON.stringify(pathnames),
          metaJson: JSON.stringify(parsed.data.meta || {}),
          status: 'pending',
          expiresAt,
        },
      });

      return {
        sessionId: row.id,
        chunkBytes: VIDEO_UPLOAD_CHUNK_BYTES,
        totalChunks: row.totalChunks,
        received: [] as number[],
        expiresAt: row.expiresAt.toISOString(),
      };
    },
    {
      rateLimitKey: 'video.upload.init',
      requireDealershipContext: true,
      requireModule: 'video_mpi',
    }
  );
}
