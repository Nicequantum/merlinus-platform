import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { uploadImageToBlob } from '@/lib/blob';
import {
  apiError,
  handleRouteError,
  reportMappedRouteError,
  VALIDATION_ERROR,
} from '@/lib/errors';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { mapAuditRouteError, mapBlobRouteError } from '@/lib/scanRouteErrors';
import { isR2Configured } from '@/lib/storage/r2';

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
]);

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

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

/** Mobile cameras often send empty MIME — infer from filename so first capture works. */
function resolveUploadContentType(file: UploadFile): string | null {
  const raw = (file.type || '').toLowerCase().trim();
  if (raw && ALLOWED_TYPES.has(raw)) return raw === 'image/jpg' ? 'image/jpeg' : raw;
  const name = (file.name || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot >= 0) {
    const ext = name.slice(dot + 1);
    if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  }
  // Last resort for camera captures with no name/type (still binary image payload)
  if (!raw || raw === 'application/octet-stream') {
    return 'image/jpeg';
  }
  return null;
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      // Fail fast with JSON so bay clients never map storage misconfig to a generic toast.
      if (!isR2Configured()) {
        return apiError(
          'Photo storage is not configured. Contact your service manager (R2 / APEX_R2).',
          503
        );
      }

      let formData: FormData;
      try {
        formData = await request.formData();
      } catch (error) {
        return reportMappedRouteError(
          {
            message: 'Could not read the photo upload. Try again or use a smaller JPEG/PNG.',
            status: 400,
            logDetail: error instanceof Error ? error.message : String(error),
          },
          error,
          'upload.formData'
        );
      }

      const file = formData.get('file');

      if (!isUploadFile(file)) {
        return apiError(VALIDATION_ERROR, 400);
      }

      const contentType = resolveUploadContentType(file);
      if (!contentType) {
        return apiError(
          `Unsupported image type "${file.type || 'unknown'}". Use JPEG, PNG, WebP, GIF, or HEIC.`,
          400
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return apiError('Image must be smaller than 8 MB.', 400);
      }

      if (file.size === 0) {
        return apiError('Empty image file. Take the photo again and retry.', 400);
      }

      let uploaded;
      try {
        // Prefer Uint8Array for workerd R2 puts (Buffer can be fragile under multi-tenant load).
        const ab = await file.arrayBuffer();
        if (ab.byteLength === 0) {
          return apiError('Empty image payload. Take the photo again and retry.', 400);
        }
        const bytes = new Uint8Array(ab);
        uploaded = await uploadImageToBlob(
          Buffer.from(bytes),
          file.name || 'capture.jpg',
          contentType
        );
      } catch (error) {
        const mapped = mapBlobRouteError(error, 'upload');
        // Always JSON — status 502/503 with explicit storage message when possible.
        return reportMappedRouteError(mapped, error, 'upload');
      }

      try {
        // Phase 6.3 — fail-closed upload provenance (extract gates on this audit row)
        await writeAuditedAccess({
          action: 'image.upload',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'image',
          entityId: uploaded.pathname,
          metadata: { pathname: uploaded.pathname, size: file.size },
          ipAddress: getRequestIp(request),
        });
      } catch (error) {
        const mapped = mapAuditRouteError(error);
        return reportMappedRouteError(mapped, error, 'upload');
      }

      return {
        pathname: uploaded.pathname,
        url: uploaded.url,
        name: file.name,
        ok: true as const,
      };
    },
    {
      rateLimitKey: 'upload',
      rateLimit: RATE_LIMITS.upload,
      requireDealershipContext: true,
      requireAuditedAccess: true,
      // Blob I/O is outside the DB tx; audit uses writeAuditedAccess separately.
      useRls: false,
    }
  ).catch((error: unknown) => {
    // Last-resort JSON envelope — never let OpenNext HTML replace bay upload errors.
    return handleRouteError(error, 'upload');
  });
}
