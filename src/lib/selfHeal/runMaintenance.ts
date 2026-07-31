import 'server-only';

import {
  isGrokSelfHealEnabled,
  isNightlySoftMaintenanceEnabled,
} from '@/lib/selfHeal/config';
import { analyzeHealthWithGrok } from '@/lib/selfHeal/analyzeWithGrok';
import { getMaintenanceWindowSnapshot } from '@/lib/selfHeal/maintenanceWindow';
import {
  loadLatestNightlyReport,
  saveMorningReport,
  saveNightlyReport,
  saveWindowState,
  type SelfHealReport,
  type SelfHealReportKind,
} from '@/lib/selfHeal/store';
import {
  aggregateAuthenticatedHealthStatus,
  buildHealthServicesPayload,
  runAuthenticatedHealthChecks,
} from '@/lib/healthChecks';
import { getGrokApiKey } from '@/lib/grokApiKey.shared';
import { probeDatabaseConnection } from '@/lib/db';
import { isObjectStorageConfigured, probeObjectStorage } from '@/lib/storage/objectStorage';
import { getRateLimitKv } from '@/lib/storage/workersKv';
import { logger } from '@/lib/logger';

export type MaintenanceRunMode = 'auto' | 'nightly' | 'morning' | 'manual';

function resolveKind(mode: MaintenanceRunMode, phase: string): SelfHealReportKind {
  if (mode === 'morning') return 'morning';
  if (mode === 'nightly') return 'nightly';
  if (mode === 'manual') return 'manual';
  return phase === 'morning_edge' ? 'morning' : 'nightly';
}

async function warmupGrok(): Promise<boolean> {
  const key = getGrokApiKey();
  if (!key) return false;
  try {
    const res = await fetch('https://api.x.ai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Nightly / morning maintenance run:
 * 1) Health matrix
 * 2) Warm DB / Grok / R2 / KV
 * 3) Optional Grok self-heal analysis (recommendations only)
 * 4) Persist report to KV for Manager console
 */
export async function runOpsMaintenance(
  mode: MaintenanceRunMode = 'auto'
): Promise<SelfHealReport> {
  const started = Date.now();
  const window = getMaintenanceWindowSnapshot();
  const kind = resolveKind(mode, window.phase);
  const errors: string[] = [];
  const selfHealEnabled = isGrokSelfHealEnabled();

  logger.info('self_heal.maintenance_start', {
    mode,
    kind,
    inWindow: window.inWindow,
    phase: window.phase,
    localHour: window.localHour,
    selfHealEnabled,
  });

  // Soft window state (never flips MERLIN_MAINTENANCE_MODE — that is operator env)
  await saveWindowState({
    inWindow: window.inWindow,
    phase: window.phase,
    softMaintenance:
      window.inWindow && isNightlySoftMaintenanceEnabled() && kind === 'nightly',
    timezone: window.timezone,
    startHour: window.startHour,
    endHour: window.endHour,
  });

  let healthOverall = 'unknown';
  let criticalFails: string[] = [];
  let warnings: string[] = [];
  let servicesPayload: Record<
    string,
    { status: string; operatorMessage?: string; latencyMs?: number }
  > = {};

  try {
    const checks = await runAuthenticatedHealthChecks({ dealershipId: null });
    healthOverall = aggregateAuthenticatedHealthStatus(checks);
    servicesPayload = buildHealthServicesPayload(checks);
    criticalFails = Object.entries(checks)
      .filter(([, c]) => c.status === 'error')
      .map(([name]) => name);
    warnings = Object.entries(checks)
      .filter(([, c]) => c.status === 'warn')
      .map(([name]) => name);
  } catch (error) {
    errors.push(
      `health_probe: ${error instanceof Error ? error.message : String(error)}`
    );
    healthOverall = 'error';
  }

  const warmup = {
    database: false,
    grok: false,
    objectStorage: false,
    kv: false,
  };

  try {
    await probeDatabaseConnection();
    warmup.database = true;
  } catch (error) {
    errors.push(`db_warmup: ${error instanceof Error ? error.message : String(error)}`);
  }

  warmup.grok = await warmupGrok();
  if (!warmup.grok) errors.push('grok_warmup: unreachable or key missing');

  try {
    if (isObjectStorageConfigured()) {
      await probeObjectStorage();
      warmup.objectStorage = true;
    } else {
      warmup.objectStorage = false;
    }
  } catch (error) {
    warmup.objectStorage = false;
    errors.push(`r2_warmup: ${error instanceof Error ? error.message : String(error)}`);
  }

  warmup.kv = Boolean(getRateLimitKv());
  if (!warmup.kv) {
    errors.push('kv_warmup: KV_STORE binding not visible');
  }

  let analysis: SelfHealReport['analysis'] = null;
  if (selfHealEnabled && (criticalFails.length > 0 || warnings.length > 0 || kind === 'nightly')) {
    const prev = await loadLatestNightlyReport();
    const result = await analyzeHealthWithGrok({
      healthServices: servicesPayload,
      criticalFails,
      warnings,
      window: {
        timezone: window.timezone,
        localHour: window.localHour,
        phase: window.phase,
      },
      previousSummary: prev?.analysis?.summary || null,
    });
    if (result) {
      analysis = {
        summary: result.summary,
        recommendations: result.recommendations,
        model: result.model,
      };
    }
  }

  const report: SelfHealReport = {
    kind,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    window: {
      timezone: window.timezone,
      localHour: window.localHour,
      inWindow: window.inWindow,
      phase: window.phase,
    },
    selfHealEnabled,
    healthOverall,
    criticalFails,
    warnings,
    warmup,
    analysis,
    errors: errors.slice(0, 12),
    ok: criticalFails.length === 0 && warmup.database,
  };

  if (kind === 'morning') {
    await saveMorningReport(report);
  } else {
    await saveNightlyReport(report);
  }

  logger.info('self_heal.maintenance_done', {
    kind,
    ok: report.ok,
    healthOverall,
    durationMs: report.durationMs,
    criticalFails: criticalFails.length,
    hasAnalysis: Boolean(analysis),
  });

  return report;
}
