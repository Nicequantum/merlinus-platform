import { Prisma } from '@prisma/client';
import {
  CONFLICT_ERROR,
  GROK_UNAVAILABLE_ERROR,
  IMAGE_STORAGE_ERROR,
  NOT_FOUND_ERROR,
} from './errors';
import {
  isScanRouteContext,
  mapBlobRouteError,
  mapGrokRouteError,
  mapScanRouteError,
  sanitizeScanErrorDetail,
  ScanRouteError,
  type RouteErrorMapping,
} from './scanRouteErrors';

/** Technician-facing labels keyed by withAuth rateLimitKey / route context. */
const ROUTE_FEATURE_LABELS: Readonly<Record<string, string>> = {
  upload: 'Photo upload',
  'ro.extract': 'Repair order scan',
  'diagnostics.extract': 'Diagnostic scan',
  'story.generate': 'Story generation',
  'story.score': 'Story scoring',
  'story.review': 'Story review',
  'story.certify': 'Story certification',
  'ros.create': 'Repair order creation',
  'ros.update': 'Repair order save',
  'ros.get': 'Repair order load',
  'ros.delete': 'Repair order delete',
  'ros.list': 'Repair order list',
  'ros.sold-metrics': 'Sold metrics save',
  'auth.login': 'Sign in',
  'auth.logout': 'Sign out',
  'auth.me': 'Session check',
  'auth.change-password': 'Password change',
  'auth.security-status': 'Security status',
  consent: 'Consent recording',
  legal_disclaimer: 'Legal disclaimer',
  'setup.seed': 'Database seed',
  'vin.decode': 'VIN decode',
  'templates.save': 'Template save',
  'templates.use': 'Template apply',
  'templates.list': 'Template list',
  'repair-orders.apply-customer-pay-template': 'Customer Pay template apply',
  'audit-logs.pdf-export': 'Audit PDF export',
  'audit-logs.latest': 'Audit verification',
  'dashboard.summary': 'Dashboard load',
  'advisors.resolve': 'Service advisor lookup',
  'images.get': 'Image load',
  'owner.summary': 'Owner national summary',
  'owner.dealerships': 'Owner dealership list',
  'owner.provision-dealer': 'Dealer provision',
};

const GROK_ROUTE_CONTEXTS = new Set([
  'story.generate',
  'story.score',
  'story.review',
  'ro.extract',
  'diagnostics.extract',
]);

function featureLabelForContext(context: string): string {
  const explicit = ROUTE_FEATURE_LABELS[context];
  if (explicit) return explicit;

  const segments = context.split(/[._-]+/).filter(Boolean);
  if (segments.length === 0) return 'Request';

  return segments
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapAuditRouteFailure(raw: string, logDetail: string): RouteErrorMapping | null {
  if (
    !/audit log rejected/i.test(raw) &&
    !/critical audit log write failed/i.test(raw) &&
    !/audit\.write_failed/i.test(raw)
  ) {
    return null;
  }

  return {
    message:
      'Changes could not be saved because the compliance audit record failed. Try again or contact your manager.',
    status: 503,
    logDetail,
  };
}

function mapPrismaRouteError(error: unknown, logDetail: string): RouteErrorMapping | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return {
          message: 'A record with this identifier already exists. Check for duplicates and try again.',
          status: 409,
          logDetail,
        };
      case 'P2025':
        return {
          message: NOT_FOUND_ERROR,
          status: 404,
          logDetail,
        };
      case 'P2034':
        return {
          message: CONFLICT_ERROR,
          status: 409,
          logDetail,
        };
      default:
        return {
          message: 'Database operation failed. Please try again in a moment.',
          status: 500,
          logDetail,
        };
    }
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return {
      message: 'Database is temporarily unavailable. Wait a moment and try again.',
      status: 503,
      logDetail,
    };
  }

  return null;
}

function mapDatabaseConnectionError(raw: string, logDetail: string): RouteErrorMapping | null {
  if (
    !/can't reach database|connection refused|connection timed out|database server/i.test(raw) &&
    !/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(raw)
  ) {
    return null;
  }

  return {
    message: 'Database is temporarily unavailable. Wait a moment and try again.',
    status: 503,
    logDetail,
  };
}

function mapEncryptionRouteError(raw: string, logDetail: string): RouteErrorMapping | null {
  if (!/encrypt|decrypt/i.test(raw)) return null;

  return {
    message: 'Saved data could not be read securely. Contact your manager or IT support.',
    status: 500,
    logDetail,
  };
}

function mapNotFoundRouteError(raw: string, logDetail: string): RouteErrorMapping | null {
  if (
    /not found for update/i.test(raw) ||
    /repair order not found/i.test(raw) ||
    /record to (update|delete) not found/i.test(raw)
  ) {
    return {
      message: NOT_FOUND_ERROR,
      status: 404,
      logDetail,
    };
  }
  return null;
}

function mapTimeoutRouteError(raw: string, featureLabel: string, logDetail: string): RouteErrorMapping | null {
  if (!/timed out|timeout|AbortError/i.test(raw)) return null;

  return {
    message: `${featureLabel} timed out — try again in a moment.`,
    status: 504,
    logDetail,
  };
}

function mapStoryCertificationError(raw: string, logDetail: string): RouteErrorMapping | null {
  if (!/story\.certify|certification gate|story certification/i.test(raw)) return null;

  const detail = sanitizeScanErrorDetail(raw, 180);
  return {
    message: detail || 'Story certification could not be completed. Run Audit Story first, then try again.',
    status: 400,
    logDetail,
  };
}

function fallbackRouteError(
  raw: string,
  featureLabel: string,
  logDetail: string
): RouteErrorMapping {
  const detail = sanitizeScanErrorDetail(raw, 180);
  const isActionable =
    detail.length > 0 &&
    detail.length <= 180 &&
    !/Bearer\s/i.test(detail) &&
    !/xai-/i.test(detail);

  if (isActionable && !detail.startsWith(featureLabel)) {
    return {
      message: `${featureLabel} failed: ${detail}`,
      status: 500,
      logDetail,
    };
  }

  if (isActionable && detail.startsWith(featureLabel)) {
    return {
      message: detail,
      status: 500,
      logDetail,
    };
  }

  return {
    message: `${featureLabel} failed. Please try again or contact your administrator.`,
    status: 500,
    logDetail,
  };
}

/**
 * Unified technician-facing error mapping for all API routes.
 * Scan routes keep specialized vision/upload messaging; other routes get actionable fallbacks.
 */
export function mapRouteError(error: unknown, context: string): RouteErrorMapping {
  if (error instanceof ScanRouteError) {
    return {
      message: error.message,
      status: error.status,
      logDetail: error.logDetail,
    };
  }

  if (isScanRouteContext(context)) {
    return mapScanRouteError(error, context);
  }

  const raw = rawErrorMessage(error);
  const logDetail = sanitizeScanErrorDetail(raw, 500);
  const featureLabel = featureLabelForContext(context);

  const auditMapped = mapAuditRouteFailure(raw, logDetail);
  if (auditMapped) return auditMapped;

  const prismaMapped = mapPrismaRouteError(error, logDetail);
  if (prismaMapped) return prismaMapped;

  const dbMapped = mapDatabaseConnectionError(raw, logDetail);
  if (dbMapped) return dbMapped;

  const encryptionMapped = mapEncryptionRouteError(raw, logDetail);
  if (encryptionMapped) return encryptionMapped;

  const notFoundMapped = mapNotFoundRouteError(raw, logDetail);
  if (notFoundMapped) return notFoundMapped;

  const certifyMapped = mapStoryCertificationError(raw, logDetail);
  if (certifyMapped) return certifyMapped;

  if (raw.includes('BLOB_READ_WRITE_TOKEN') || /blob storage|blob upload/i.test(raw)) {
    return mapBlobRouteError(error, context === 'upload' ? 'upload' : 'fetch');
  }

  if (
    GROK_ROUTE_CONTEXTS.has(context) ||
    raw.includes('Grok API') ||
    raw.includes('GROK_API_KEY') ||
    raw.includes('xAI')
  ) {
    return mapGrokRouteError(error, featureLabel);
  }

  if (raw.includes('GROK_API_KEY') || raw.includes('Grok API')) {
    return {
      message: GROK_UNAVAILABLE_ERROR,
      status: 503,
      logDetail,
    };
  }

  if (/could not parse diagnostic|could not parse/i.test(raw)) {
    return {
      message: `${featureLabel} — AI returned unreadable data. Try again with clearer input.`,
      status: 502,
      logDetail,
    };
  }

  const timeoutMapped = mapTimeoutRouteError(raw, featureLabel, logDetail);
  if (timeoutMapped) return timeoutMapped;

  if (/unique constraint|already exists/i.test(raw)) {
    return {
      message: 'A record with this identifier already exists. Check for duplicates and try again.',
      status: 409,
      logDetail,
    };
  }

  if (/repair order was updated elsewhere|updatedAt/i.test(raw)) {
    return {
      message: CONFLICT_ERROR,
      status: 409,
      logDetail,
    };
  }

  return fallbackRouteError(raw, featureLabel, logDetail);
}