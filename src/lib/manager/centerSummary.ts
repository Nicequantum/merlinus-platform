/**
 * Manager Control Center — aggregated rooftop ops snapshot (single pane of glass).
 */
import 'server-only';

import { getRlsDb } from '@/lib/apex/rlsContext';
import {
  getDealershipJobHealthStats,
  listDealershipAiJobs,
  type AiJobQueueHealthStats,
} from '@/lib/aiJobs/service';
import {
  aggregateAuthenticatedHealthStatus,
  buildHealthServicesPayload,
  runAuthenticatedHealthChecks,
  type DependencyCheck,
  type HealthServiceStatus,
} from '@/lib/healthChecks';
import { isMaintenanceModeEnabled } from '@/lib/env';
import { listModuleStatuses, type ModuleStatus } from '@/lib/modules/entitlements';
import { isAiJobsQueueConfigured } from '@/lib/queue/binding';
import { getQueueMetricsSnapshot, type QueueMetricsSnapshot } from '@/lib/queue/metrics';
import {
  getDepartmentCustomization,
  type TailoringDepartment,
} from '@/lib/voiceAgent/customization';
import {
  VOICE_DEPARTMENT_TO_MODULE,
  type VoiceDepartmentId,
} from '@/lib/modules/catalog';
import { isModuleEnabled } from '@/lib/modules/entitlements';

export type ManagerCenterKpis = {
  totalRepairOrders: number;
  activeTechnicians: number;
  warrantyStories: number;
  auditEventsThisWeek: number;
  aiJobsToday: number;
  aiJobsActive: number;
  voiceQueriesApprox7d: number;
  modulesEnabled: number;
  modulesTotal: number;
};

export type ManagerCenterHealth = {
  overall: 'ok' | 'degraded' | 'error';
  maintenanceMode: boolean;
  services: Record<string, HealthServiceStatus>;
  /** Critical subset for overview cards */
  critical: Array<{
    id: string;
    label: string;
    status: 'ok' | 'warn' | 'error';
    latencyMs?: number;
  }>;
};

export type ManagerCenterVoiceSlice = {
  parentEnabled: boolean;
  departments: Array<{
    department: VoiceDepartmentId | 'receptionist';
    moduleId: string;
    enabled: boolean;
    tailoringActive: boolean;
    tailoringVersion: number;
  }>;
};

/** First-class AI queue signal for Control Center (mirrors healthChecks aiJobsQueue). */
export type ManagerCenterQueueSignal = {
  status: 'ok' | 'warn' | 'error';
  /** Compact metrics line */
  detail?: string;
  /** What the manager/ops should do */
  operatorGuidance: string;
  oldestQueuedAgeMs: number | null;
  oldestQueuedAgeMinutes: number | null;
  queueConfigured: boolean;
};

export type ManagerCenterSummary = {
  dealershipId: string;
  generatedAt: string;
  kpis: ManagerCenterKpis;
  health: ManagerCenterHealth;
  queue: AiJobQueueHealthStats;
  /** P0-4 elevated queue posture + operator guidance */
  queueSignal: ManagerCenterQueueSignal;
  queueMetrics: Pick<
    QueueMetricsSnapshot,
    'enqueued' | 'completed' | 'failed' | 'retried' | 'inlineFallback' | 'byJobType' | 'byPriority'
  >;
  recentJobs: Array<{
    id: string;
    kind: string;
    status: string;
    progress: number;
    phase?: string;
    technicianId?: string;
    createdAt: string;
    errorMessage: string | null;
  }>;
  modules: ModuleStatus[];
  voice: ManagerCenterVoiceSlice;
  quickLinks: Array<{ id: string; label: string; href: string; description: string }>;
};

const CRITICAL_MAP: Array<{ id: string; label: string; keys: string[] }> = [
  { id: 'database', label: 'Database', keys: ['database'] },
  { id: 'ai', label: 'AI (Grok)', keys: ['grok', 'grokConfig'] },
  { id: 'queue', label: 'AI Jobs Queue', keys: ['aiJobsQueue'] },
  { id: 'voice', label: 'Voice', keys: ['voiceDepartments', 'twilioVoice', 'voice'] },
  { id: 'storage', label: 'Object storage (R2)', keys: ['objectStorage'] },
];

function pickCritical(
  checks: Record<string, DependencyCheck>
): ManagerCenterHealth['critical'] {
  return CRITICAL_MAP.map((row) => {
    let status: 'ok' | 'warn' | 'error' = 'ok';
    let latencyMs: number | undefined;
    for (const key of row.keys) {
      const c = checks[key];
      if (!c) continue;
      if (c.status === 'error') status = 'error';
      else if (c.status === 'warn' && status !== 'error') status = 'warn';
      if (c.latencyMs != null) latencyMs = c.latencyMs;
    }
    return { id: row.id, label: row.label, status, latencyMs };
  });
}

export async function buildManagerCenterSummary(input: {
  dealershipId: string;
}): Promise<ManagerCenterSummary> {
  const dealershipId = input.dealershipId.trim();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const db = getRlsDb();

  const [
    totalRepairOrders,
    warrantyStories,
    activeTechnicians,
    auditEventsThisWeek,
    aiJobsToday,
    checks,
    queue,
    modules,
    recentJobs,
    voiceParent,
  ] = await Promise.all([
    db.repairOrder.count({ where: { dealershipId } }),
    db.repairLine.count({
      where: {
        warrantyStoryEncrypted: { not: null },
        NOT: { warrantyStoryEncrypted: '' },
        repairOrder: { dealershipId },
      },
    }),
    db.technician.count({ where: { dealershipId, isActive: true, deletedAt: null } }),
    db.auditLog.count({
      where: { dealershipId, createdAt: { gte: weekAgo } },
    }),
    db.aiJob.count({
      where: { dealershipId, createdAt: { gte: startOfDay } },
    }),
    runAuthenticatedHealthChecks({ dealershipId }),
    getDealershipJobHealthStats(dealershipId),
    listModuleStatuses(dealershipId),
    listDealershipAiJobs({ dealershipId, take: 12 }),
    isModuleEnabled(dealershipId, 'voice_agent'),
  ]);

  const modulesEnabled = modules.filter((m) => m.enabled).length;
  const metrics = getQueueMetricsSnapshot();
  const overall = aggregateAuthenticatedHealthStatus(checks);

  const aiJobsCheck = checks.aiJobsQueue;
  const oldestMs = queue.oldestQueuedAgeMs;
  const queueSignal: ManagerCenterQueueSignal = {
    status: aiJobsCheck?.status === 'error' || aiJobsCheck?.status === 'warn' || aiJobsCheck?.status === 'ok'
      ? aiJobsCheck.status
      : 'ok',
    detail: aiJobsCheck?.detail,
    operatorGuidance: (() => {
      const d = aiJobsCheck?.detail || '';
      const opsIdx = d.indexOf('| ops: ');
      if (opsIdx >= 0) return d.slice(opsIdx + 7).trim();
      if (aiJobsCheck?.status === 'error') {
        return 'AI queue critical — open AI Jobs + Health tabs; restore consumer/bindings before peak.';
      }
      if (aiJobsCheck?.status === 'warn') {
        return 'AI queue elevated — monitor depth and oldest job age; confirm consumer is processing.';
      }
      return 'AI queue healthy. Durable jobs available; inline fallback is secondary.';
    })(),
    oldestQueuedAgeMs: oldestMs,
    oldestQueuedAgeMinutes:
      oldestMs != null && oldestMs > 0 ? Math.round(oldestMs / 60_000) : null,
    queueConfigured: isAiJobsQueueConfigured(),
  };

  // Voice usage approx: hub audit + voice customization updates in 7d
  let voiceQueriesApprox7d = 0;
  try {
    voiceQueriesApprox7d = await db.hubAuditEvent.count({
      where: {
        dealershipId,
        action: 'voice.department_query',
        createdAt: { gte: weekAgo },
      },
    });
  } catch {
    voiceQueriesApprox7d = 0;
  }

  const voiceDepts: ManagerCenterVoiceSlice['departments'] = [];
  for (const dept of ['service', 'loaner', 'parts', 'sales'] as VoiceDepartmentId[]) {
    const moduleId = VOICE_DEPARTMENT_TO_MODULE[dept];
    const mod = modules.find((m) => m.moduleId === moduleId);
    let tailoringActive = false;
    let tailoringVersion = 0;
    try {
      const c = await getDepartmentCustomization(dealershipId, dept as TailoringDepartment);
      tailoringActive = c.isCustomized;
      tailoringVersion = c.version;
    } catch {
      // ignore
    }
    voiceDepts.push({
      department: dept,
      moduleId,
      enabled: Boolean(mod?.enabled),
      tailoringActive,
      tailoringVersion,
    });
  }
  // Receptionist tailoring (no separate SKU)
  try {
    const rec = await getDepartmentCustomization(dealershipId, 'receptionist');
    voiceDepts.push({
      department: 'receptionist',
      moduleId: 'voice_agent',
      enabled: voiceParent,
      tailoringActive: rec.isCustomized,
      tailoringVersion: rec.version,
    });
  } catch {
    // ignore
  }

  return {
    dealershipId,
    generatedAt: new Date().toISOString(),
    kpis: {
      totalRepairOrders,
      activeTechnicians,
      warrantyStories,
      auditEventsThisWeek,
      aiJobsToday,
      aiJobsActive: queue.queueDepth,
      voiceQueriesApprox7d,
      modulesEnabled,
      modulesTotal: modules.length,
    },
    health: {
      overall,
      maintenanceMode: isMaintenanceModeEnabled(),
      services: buildHealthServicesPayload(checks),
      critical: pickCritical(checks),
    },
    queue,
    queueSignal,
    queueMetrics: {
      enqueued: metrics.enqueued,
      completed: metrics.completed,
      failed: metrics.failed,
      retried: metrics.retried,
      inlineFallback: metrics.inlineFallback,
      byJobType: metrics.byJobType,
      byPriority: metrics.byPriority,
    },
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      progress: j.progress,
      phase: j.phase,
      technicianId: j.technicianId,
      createdAt: j.createdAt,
      errorMessage: j.errorMessage,
    })),
    modules,
    voice: {
      parentEnabled: voiceParent,
      departments: voiceDepts,
    },
    quickLinks: [
      {
        id: 'jobs',
        label: 'AI Jobs',
        href: '/manager/jobs',
        description: 'Retry, cancel, and monitor durable AI jobs',
      },
      {
        id: 'tailoring',
        label: 'Voice Tailoring',
        href: '/manager/center?tab=voice',
        description: 'Department prompts and personalization',
      },
      {
        id: 'modules',
        label: 'Modules',
        href: '/manager/center?tab=modules',
        description: 'Enable product SKUs for this rooftop',
      },
      {
        id: 'health',
        label: 'System Health',
        href: '/manager/center?tab=health',
        description: 'Dependency matrix and maintenance status',
      },
    ],
  };
}
