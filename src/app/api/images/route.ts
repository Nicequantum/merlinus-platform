import { streamPrivateBlob } from '@/lib/blob';
import { withAuth } from '@/lib/apiRoute';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { userCanAccessImage } from '@/lib/imageAccess';
import { isAllowedImagePathname } from '@/lib/imageUrls';
import { logger } from '@/lib/logger';
import { imagePathnameQuerySchema, parseQueryParams } from '@/lib/validation';

/** M22/M23: images route uses withAuth for consent gate + consistent rate limiting. */
export async function GET(request: Request) {
  const query = parseQueryParams(request, imagePathnameQuerySchema);
  if ('error' in query) return query.error;

  return withAuth(
    request,
    async (session) => {
      const { pathname } = query.data;
      if (!isAllowedImagePathname(pathname)) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      const allowed = await userCanAccessImage(session, pathname);
      if (!allowed) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      try {
        const result = await streamPrivateBlob(pathname);
        if (!result) {
          return apiError(NOT_FOUND_ERROR, 404);
        }

        return new Response(result.stream, {
          headers: {
            'Content-Type': result.contentType || 'application/octet-stream',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch (error) {
        logger.error('images.stream_failed', {
          pathname,
          technicianId: session.technicianId,
          error: error instanceof Error ? error.message : 'unknown',
        });
        return apiError('Unable to load image.', 500);
      }
    },
    { rateLimitKey: 'images.get' }
  );
}