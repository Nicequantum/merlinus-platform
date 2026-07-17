import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { findInspectionForSession } from '@/lib/videoInspection/access';
import {
  buildCustomerViewerUrl,
  generateShareToken,
  hashPasscode,
  hashShareToken,
} from '@/lib/videoInspection/shareTokens';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });
const bodySchema = z.object({
  passcode: z.string().trim().min(4).max(64).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const existing = await findInspectionForSession(session, routeParams.data.id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);
      if (!existing.videoPathname?.trim()) {
        return apiError('Upload a video before sharing.', 400);
      }

      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const token = generateShareToken();
      const tokenHash = hashShareToken(token);
      const passcodeHash = parsed.data.passcode ? hashPasscode(parsed.data.passcode) : null;
      const expiresAt = parsed.data.expiresInHours
        ? new Date(Date.now() + parsed.data.expiresInHours * 3600_000)
        : new Date(Date.now() + 14 * 24 * 3600_000);

      const share = await getRlsDb().videoInspectionShare.create({
        data: {
          videoInspectionId: existing.id,
          tokenHash,
          passcodeHash,
          expiresAt,
          createdByTechnicianId: session.technicianId,
        },
      });

      await writeAuditedAccess({
        action: 'video.share_create',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'video_inspection_share',
        entityId: share.id,
        metadata: {
          videoInspectionId: existing.id,
          hasPasscode: Boolean(passcodeHash),
          expiresAt: expiresAt.toISOString(),
        },
        ipAddress: getRequestIp(request),
      });

      return {
        shareId: share.id,
        url: buildCustomerViewerUrl(token),
        token,
        expiresAt: expiresAt.toISOString(),
      };
    },
    { rateLimitKey: 'video.share', requireDealershipContext: true }
  );
}
