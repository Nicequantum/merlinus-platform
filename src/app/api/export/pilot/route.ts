/**
 * GET /api/export/pilot
 * Manifest + dual auth (owner session | PILOT_EXPORT_TOKEN).
 * Intentional bare — service token for GCP migration partners.
 */
import { NextResponse } from 'next/server';
import { authorizePilotExport } from '@/lib/pilotExport/auth';
import { runPilotExport } from '@/lib/pilotExport/runExport';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { apiError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, 'export.pilot', {
    ...RATE_LIMITS.default,
    limit: 20,
  });
  if (limited) return limited;

  const auth = await authorizePilotExport(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, code: auth.code },
      { status: auth.status }
    );
  }

  try {
    const url = new URL(request.url);
    const result = await runPilotExport({
      dataset: 'manifest',
      actor: auth.actor,
      limitRaw: url.searchParams.get('limit'),
      cursorRaw: url.searchParams.get('cursor'),
      dealershipId: url.searchParams.get('dealershipId'),
      since: url.searchParams.get('since'),
      until: url.searchParams.get('until'),
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, code: result.code },
        { status: result.status }
      );
    }

    try {
      await writeAuditedAccess({
        action: 'pilot.export',
        dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
        technicianId: auth.actor.technicianId ?? undefined,
        entityType: 'pilot_export',
        entityId: 'manifest',
        ipAddress: getRequestIp(request),
        authSource: 'legacy',
        scopeMode: 'national',
        metadata: {
          dataset: 'manifest',
          authMode: auth.actor.mode,
          resultCount: result.data.length,
        },
      });
    } catch (e) {
      logger.warn('pilot.export_audit_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Pilot-Export-Schema': result.meta.schemaVersion,
      },
    });
  } catch (error) {
    logger.error('pilot.export_failed', {
      dataset: 'manifest',
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError('Pilot export failed', 500);
  }
}
