/**
 * GET /api/ops/self-heal — manager/owner visibility into nightly self-heal
 * POST /api/ops/self-heal — manager-triggered manual maintenance run
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/apiRoute';
import { isGrokSelfHealEnabled } from '@/lib/selfHeal/config';
import { getMaintenanceWindowSnapshot } from '@/lib/selfHeal/maintenanceWindow';
import { runOpsMaintenance } from '@/lib/selfHeal/runMaintenance';
import {
  loadLatestMorningReport,
  loadLatestNightlyReport,
  loadWindowState,
} from '@/lib/selfHeal/store';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  return withAuth(
    request,
    async () => {
      const [nightly, morning, windowState] = await Promise.all([
        loadLatestNightlyReport(),
        loadLatestMorningReport(),
        loadWindowState(),
      ]);

      return NextResponse.json(
        {
          selfHealEnabled: isGrokSelfHealEnabled(),
          window: getMaintenanceWindowSnapshot(),
          windowState,
          latestNightly: nightly,
          latestMorning: morning,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },
    {
      requireManager: true,
      rateLimitKey: 'ops.self_heal_status',
      skipRateLimit: true,
      useRls: false,
    }
  );
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      logger.info('ops.self_heal_manual', {
        technicianId: session.technicianId,
        dealershipId: session.dealershipId,
      });
      const report = await runOpsMaintenance('manual');
      return NextResponse.json(
        { ok: report.ok, report },
        { status: report.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
      );
    },
    {
      requireManager: true,
      rateLimitKey: 'ops.self_heal_run',
      useRls: false,
    }
  );
}
