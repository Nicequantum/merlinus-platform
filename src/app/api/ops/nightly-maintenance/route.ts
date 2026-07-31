/**
 * POST /api/ops/nightly-maintenance
 *
 * Cron / companion Worker entry for nightly self-heal + morning warmup.
 * Auth: Bearer OPS_MAINTENANCE_SECRET (or AI_QUEUE_CONSUMER_SECRET).
 *
 * Body optional: { "mode": "auto" | "nightly" | "morning" | "manual" }
 * GET returns latest report + window without running.
 */
import { NextResponse } from 'next/server';
import { isOpsCronAuthorized, isGrokSelfHealEnabled } from '@/lib/selfHeal/config';
import { getMaintenanceWindowSnapshot } from '@/lib/selfHeal/maintenanceWindow';
import { runOpsMaintenance, type MaintenanceRunMode } from '@/lib/selfHeal/runMaintenance';
import {
  loadLatestMorningReport,
  loadLatestNightlyReport,
  loadWindowState,
} from '@/lib/selfHeal/store';
import { apiError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function parseMode(raw: unknown): MaintenanceRunMode {
  if (raw === 'nightly' || raw === 'morning' || raw === 'manual' || raw === 'auto') {
    return raw;
  }
  return 'auto';
}

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, 'ops.nightly_status', RATE_LIMITS.default);
  if (limited) return limited;

  if (!isOpsCronAuthorized(request)) {
    // Managers can still see status via /api/ops/self-heal (session auth).
    return apiError('Unauthorized', 401);
  }

  const [nightly, morning, windowState] = await Promise.all([
    loadLatestNightlyReport(),
    loadLatestMorningReport(),
    loadWindowState(),
  ]);

  return NextResponse.json(
    {
      ok: true,
      selfHealEnabled: isGrokSelfHealEnabled(),
      window: getMaintenanceWindowSnapshot(),
      windowState,
      latestNightly: nightly,
      latestMorning: morning,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'ops.nightly_run', RATE_LIMITS.generate);
  if (limited) return limited;

  if (!isOpsCronAuthorized(request)) {
    return apiError('Unauthorized', 401);
  }

  let mode: MaintenanceRunMode = 'auto';
  try {
    const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
    mode = parseMode(body?.mode);
  } catch {
    mode = 'auto';
  }

  try {
    const report = await runOpsMaintenance(mode);
    return NextResponse.json(
      { ok: report.ok, report },
      { status: report.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    logger.error('ops.nightly_maintenance_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError('Maintenance run failed', 500);
  }
}
