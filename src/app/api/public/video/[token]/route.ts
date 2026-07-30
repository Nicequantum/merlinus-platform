import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { withPublicRoute } from '@/lib/apiRoute';
import { decryptSensitiveText } from '@/lib/encryption';
import { writeAuditLog } from '@/lib/audit';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { mapFindingDto } from '@/lib/videoInspection/findingsServer';
import {
  hashShareToken,
  isValidRawShareToken,
  verifyPasscodeHash,
} from '@/lib/videoInspection/shareTokens';

/**
 * Public customer video metadata endpoint.
 * Share-token gated (opaque token → SHA-256, expiry, optional passcode).
 * P0-4: withPublicRoute for rate limit + JSON error envelope.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  return withPublicRoute(
    request,
    async () => {
      const { token } = await params;
      const raw = token?.trim();
      if (!isValidRawShareToken(raw)) return apiError(NOT_FOUND_ERROR, 404);

      const tokenHash = hashShareToken(raw!);
      const share = await withRlsBypass(async () =>
        getRlsDb().videoInspectionShare.findUnique({
          where: { tokenHash },
          include: {
            videoInspection: {
              include: {
                dealership: { select: { name: true } },
                findings: { orderBy: { sortOrder: 'asc' as const } },
              },
            },
          },
        })
      );

      if (!share || share.revokedAt) return apiError(NOT_FOUND_ERROR, 404);
      if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
        return apiError('This inspection link has expired.', 410);
      }

      const inspection = share.videoInspection;
      if (!inspection?.videoPathname) return apiError(NOT_FOUND_ERROR, 404);

      if (share.passcodeHash) {
        const provided = request.headers.get('x-video-passcode')?.trim() || '';
        if (!verifyPasscodeHash(provided, share.passcodeHash)) {
          // Do not leak dealership name before passcode unlock.
          return Response.json({ requiresPasscode: true }, { status: 401 });
        }
      }

      await withRlsBypass(async () =>
        getRlsDb().videoInspectionShare.update({
          where: { id: share.id },
          data: { viewCount: { increment: 1 } },
        })
      ).catch(() => undefined);

      // Compliance: durable public view trail (no customer PII in metadata).
      await writeAuditLog({
        action: 'video.public_view',
        dealershipId: inspection.dealershipId,
                entityType: 'video_inspection_share',
        entityId: share.id,
        metadata: {
          videoInspectionId: inspection.id,
          hasPasscode: Boolean(share.passcodeHash),
        },
      }).catch(() => undefined);

      const host =
        request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
        request.headers.get('host')?.trim() ||
        '';
      const proto =
        request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'http'
          ? 'http'
          : 'https';
      const mediaPath = `/api/public/video/${encodeURIComponent(raw!)}/media`;
      const mediaUrl = host ? `${proto}://${host}${mediaPath}` : mediaPath;

      // Decrypted finding notes for customer G/Y/R summary (no internal IDs required).
      const findings = (inspection.findings ?? []).map((row) => {
        const dto = mapFindingDto(row);
        return {
          category: dto.category,
          severity: String(dto.severity),
          note: dto.note || '',
        };
      });

      return Response.json({
        title: inspection.title,
        vehicleLabel: inspection.vehicleLabel,
        dealershipName: inspection.dealership?.name ?? null,
        report: decryptSensitiveText(inspection.reportEncrypted || ''),
        findings,
        mediaUrl,
        hasVideo: Boolean(inspection.videoPathname?.trim()),
        contentType: inspection.contentType || 'video/webm',
        createdAt: inspection.createdAt.toISOString(),
      });
    },
    { rateLimitKey: 'video.public_get', rateLimit: RATE_LIMITS.default }
  );
}
