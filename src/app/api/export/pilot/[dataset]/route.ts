/**
 * GET /api/export/pilot/:dataset
 * Paginated / snapshot pilot datasets for GCP migration partners + owners.
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

type Ctx = { params: Promise<{ dataset: string }> };

export async function GET(request: Request, context: Ctx) {
  const limited = await checkRateLimit(request, 'export.pilot_dataset', {
    ...RATE_LIMITS.default,
    limit: 30,
  });
  if (limited) return limited;

  const auth = await authorizePilotExport(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, code: auth.code },
      { status: auth.status }
    );
  }

  const { dataset } = await context.params;
  const url = new URL(request.url);

  try {
    const result = await runPilotExport({
      dataset: dataset.trim(),
      actor: auth.actor,
      limitRaw: url.searchParams.get('limit'),
      cursorRaw: url.searchParams.get('cursor'),
      dealershipId: url.searchParams.get('dealershipId'),
      since: url.searchParams.get('since'),
      until: url.searchParams.get('until'),
    });

    if (!('ok' in result) || result.ok === false) {
      const err = result as { ok: false; status: number; code: string; error: string };
      return NextResponse.json(
        { ok: false, error: err.error, code: err.code },
        { status: err.status }
      );
    }

    try {
      await writeAuditedAccess({
        action: 'pilot.export',
        dealershipId:
          result.meta.dealershipIds[0] || APEX_NATIONAL_DEALERSHIP_ID,
        technicianId: auth.actor.technicianId ?? undefined,
        entityType: 'pilot_export',
        entityId: dataset,
        ipAddress: getRequestIp(request),
        authSource: 'legacy',
        scopeMode: 'national',
        metadata: {
          dataset,
          authMode: auth.actor.mode,
          resultCount: result.data.length,
          hasMore: result.meta.hasMore,
          rooftopCount: result.meta.dealershipIds.length,
        },
      });
    } catch (e) {
      logger.warn('pilot.export_audit_failed', {
        dataset,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Pilot-Export-Schema': result.meta.schemaVersion,
        ...(result.meta.nextCursor
          ? { 'X-Pilot-Export-Next-Cursor': result.meta.nextCursor }
          : {}),
      },
    });
  } catch (error) {
    logger.error('pilot.export_failed', {
      dataset,
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError('Pilot export failed', 500);
  }
}
