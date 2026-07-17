import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { decryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  hashShareToken,
  isValidRawShareToken,
  verifyPasscodeHash,
} from '@/lib/videoInspection/shareTokens';

/**
 * Public customer video metadata endpoint.
 * Intentionally NOT wrapped with withAuth — access is share-token gated
 * (opaque token → SHA-256 lookup, expiry, optional passcode, revoke).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const rateLimited = await checkRateLimit(request, 'video.public_get', RATE_LIMITS.default);
  if (rateLimited) return rateLimited;

  const { token } = await params;
  const raw = token?.trim();
  if (!isValidRawShareToken(raw)) return apiError(NOT_FOUND_ERROR, 404);

  const tokenHash = hashShareToken(raw!);
  const share = await withRlsBypass(async () =>
    getRlsDb().videoInspectionShare.findUnique({
      where: { tokenHash },
      include: {
        videoInspection: {
          include: { dealership: { select: { name: true } } },
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

  // Optional passcode: require header x-video-passcode matching stored hash
  if (share.passcodeHash) {
    const provided = request.headers.get('x-video-passcode')?.trim() || '';
    if (!verifyPasscodeHash(provided, share.passcodeHash)) {
      return Response.json(
        { requiresPasscode: true, dealershipName: inspection.dealership?.name ?? null },
        { status: 401 }
      );
    }
  }

  await withRlsBypass(async () =>
    getRlsDb().videoInspectionShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 } },
    })
  ).catch(() => undefined);

  return Response.json({
    title: inspection.title,
    vehicleLabel: inspection.vehicleLabel,
    dealershipName: inspection.dealership?.name ?? null,
    report: decryptSensitiveText(inspection.reportEncrypted || ''),
    mediaUrl: `/api/public/video/${encodeURIComponent(raw!)}/media`,
    createdAt: inspection.createdAt.toISOString(),
  });
}
