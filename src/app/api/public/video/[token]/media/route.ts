import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { parseBytesRangeHeader } from '@/lib/storage/byteRange';
import { buildRangedObjectResponse } from '@/lib/storage/objectStorage';
import {
  hashShareToken,
  isValidRawShareToken,
  verifyPasscodeHash,
} from '@/lib/videoInspection/shareTokens';
import { isAllowedVideoPathname, streamPrivateVideoBlob } from '@/lib/videoBlob';

/**
 * Public customer video media stream.
 * Intentionally NOT wrapped with withAuth — access is share-token gated
 * (opaque token → SHA-256 lookup, expiry, optional passcode, revoke, path allowlist).
 * Supports HTTP Range so Safari/Chrome can play progressive video inline.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const rateLimited = await checkRateLimit(request, 'video.public_media', RATE_LIMITS.default);
  if (rateLimited) return rateLimited;

  const { token } = await params;
  const raw = token?.trim();
  if (!isValidRawShareToken(raw)) return apiError(NOT_FOUND_ERROR, 404);

  const tokenHash = hashShareToken(raw!);
  const share = await withRlsBypass(async () =>
    getRlsDb().videoInspectionShare.findUnique({
      where: { tokenHash },
      include: { videoInspection: true },
    })
  );

  if (!share || share.revokedAt) return apiError(NOT_FOUND_ERROR, 404);
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
    return apiError('This inspection link has expired.', 410);
  }

  if (share.passcodeHash) {
    const provided = request.headers.get('x-video-passcode')?.trim() || '';
    if (!verifyPasscodeHash(provided, share.passcodeHash)) {
      return apiError('Passcode required', 401);
    }
  }

  const pathname = share.videoInspection.videoPathname;
  if (!pathname || !isAllowedVideoPathname(pathname)) {
    return apiError(NOT_FOUND_ERROR, 404);
  }

  const fallbackSize =
    share.videoInspection.sizeBytes > 0 ? share.videoInspection.sizeBytes : undefined;
  const rangeHeader = request.headers.get('range') || request.headers.get('Range');
  const rangePlan =
    typeof fallbackSize === 'number'
      ? parseBytesRangeHeader(rangeHeader, fallbackSize)
      : ({ kind: 'full' } as const);

  if (rangePlan === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${fallbackSize}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  try {
    const result = await streamPrivateVideoBlob(
      pathname,
      rangePlan.kind === 'full' ? undefined : { range: rangePlan }
    );
    if (!result) return apiError(NOT_FOUND_ERROR, 404);
    return buildRangedObjectResponse(result, request, {
      contentType:
        share.videoInspection.contentType || result.contentType || 'video/webm',
      fallbackSize,
    });
  } catch {
    return apiError(NOT_FOUND_ERROR, 404);
  }
}
