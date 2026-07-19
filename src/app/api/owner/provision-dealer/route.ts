import { NextResponse } from 'next/server';
import {
  assertNotProductionWithoutProvisionUrl,
  httpStatusForProvisionError,
  isHttpProvisionEnabled,
  provisionDealer,
  ProvisionDealerError,
  toSafeProvisionHttpResponse,
} from '@/lib/apex/provisionDealer';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { isApexPlatformMode } from '@/lib/platformMode';
import { getRequestIp } from '@/lib/rate-limit';
import { parseRequestBody, provisionDealerHttpSchema } from '@/lib/validation';

/** Strict ceiling for owner provision (in addition to engine daily cap). */
const PROVISION_HTTP_RATE_LIMIT = { limit: 5, windowMs: 60_000 } as const;

function provisionHttpError(code: string, message: string, status?: number): NextResponse {
  return NextResponse.json(
    { error: message, code },
    { status: status ?? httpStatusForProvisionError(code) }
  );
}

/**
 * POST /api/owner/provision-dealer
 *
 * Opt-in national owner endpoint (APEX_ALLOW_HTTP_PROVISION=true).
 * Reuses the same provisionDealer core as the CLI: RLS bypass tx, fail-closed
 * dealer.provision audit, password never logged or returned.
 */
export async function POST(request: Request) {
  if (!isApexPlatformMode()) {
    return apiError('Dealer provision is only available in apex platform mode.', 404);
  }

  if (!isHttpProvisionEnabled()) {
    return provisionHttpError(
      'HTTP_PROVISION_DISABLED',
      'HTTP dealer provision is disabled. Set APEX_ALLOW_HTTP_PROVISION=true to enable.',
      403
    );
  }

  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, provisionDealerHttpSchema);
      if ('error' in parsed) return parsed.error;

      const body = parsed.data;
      // Hold passwords only for the provision call; never put them on session/result objects.
      let managerPassword = body.manager.password;
      let ownerPassword = body.owner?.password ?? '';

      try {
        assertNotProductionWithoutProvisionUrl();

        const result = await provisionDealer({
          dealerCode: body.dealerCode,
          dealerName: body.dealerName,
          rooftopName: body.rooftopName,
          templateId: body.templateId,
          manager: {
            name: body.manager.name,
            email: body.manager.email,
            password: managerPassword,
            d7Number: body.manager.d7Number ?? null,
            apexUsername: body.manager.apexUsername ?? null,
          },
          owner: body.owner
            ? {
                name: body.owner.name,
                email: body.owner.email,
                password: ownerPassword,
              }
            : null,
          ifExists: body.ifExists,
          dryRun: body.dryRun,
          actor: {
            type: 'owner_api',
            id: session.technicianId,
          },
        });

        managerPassword = '';
        ownerPassword = '';

        logger.info('apex.http_dealer_provision', {
          outcome: result.skipped ? 'skipped' : result.dryRun ? 'dry_run' : result.created ? 'created' : 'ok',
          dealerId: result.dealerId,
          dealershipId: result.dealershipId,
          templateId: result.templateId,
          actorTechnicianId: session.technicianId,
          ipAddress: getRequestIp(request),
          dryRun: result.dryRun,
          ownerOutcome: result.ownerCreated ? 'created' : result.ownerLinked ? 'linked' : 'none',
          // Never log password, email, D7, rooftopName, or plain dealerCode
        });

        return toSafeProvisionHttpResponse(result);
      } catch (error) {
        managerPassword = '';
        ownerPassword = '';

        if (error instanceof ProvisionDealerError) {
          logger.warn('apex.http_dealer_provision_failed', {
            code: error.code,
            actorTechnicianId: session.technicianId,
            ipAddress: getRequestIp(request),
          });
          return provisionHttpError(error.code, error.message);
        }
        throw error;
      }
    },
    {
      requireOwner: true,
      requireOwnerNational: true,
      rateLimitKey: 'owner.provision-dealer',
      rateLimit: PROVISION_HTTP_RATE_LIMIT,
      // Provision engine uses withRlsBypass; do not bind dealership-scoped RLS.
      useRls: false,
    }
  );
}
