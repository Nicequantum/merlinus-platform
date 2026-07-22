'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ClipboardList,
  Cpu,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  Loader2,
  Phone,
  Puzzle,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ManagerJobsMonitor } from '@/components/ManagerJobsMonitor';
import { DepartmentTailoringPanel } from '@/components/voice/DepartmentTailoringPanel';
import {
  useControlCenterLive,
  type LiveConnectionState,
} from '@/hooks/useControlCenterLive';
import type { TechnicianSession } from '@/types';

export type ManagerCenterTab =
  | 'overview'
  | 'jobs'
  | 'voice'
  | 'modules'
  | 'health';

type CenterSummary = Awaited<ReturnType<typeof api.getManagerCenterSummary>>;

interface ManagerControlCenterProps {
  session: TechnicianSession;
  initialTab?: ManagerCenterTab;
  onOpenSettings: () => void;
  onLogout: () => void;
  onBack?: () => void;
  /** Optional: open legacy home dashboard */
  onOpenHome?: () => void;
}

const TABS: Array<{ id: ManagerCenterTab; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} /> },
  { id: 'jobs', label: 'AI Jobs', icon: <Cpu size={16} /> },
  { id: 'voice', label: 'Voice', icon: <Phone size={16} /> },
  { id: 'modules', label: 'Modules', icon: <Puzzle size={16} /> },
  { id: 'health', label: 'Health', icon: <HeartPulse size={16} /> },
];

function statusDot(status: string): string {
  if (status === 'ok') return 'bg-emerald-500';
  if (status === 'warn' || status === 'degraded') return 'bg-amber-500';
  return 'bg-red-500';
}

function KpiCard({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="stat-card p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-benz-secondary mb-2">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-benz-muted mt-1">{hint}</div> : null}
    </div>
  );
}

function liveStatusLabel(state: LiveConnectionState): { text: string; className: string } {
  switch (state) {
    case 'live':
      return { text: 'Live', className: 'status-pill-valid' };
    case 'connecting':
      return { text: 'Connecting', className: 'status-pill-warn' };
    case 'reconnecting':
      return { text: 'Reconnecting', className: 'status-pill-warn' };
    case 'fallback':
      return { text: 'Polling', className: 'status-pill-warn' };
    default:
      return { text: 'Paused', className: '' };
  }
}

export function ManagerControlCenter({
  session,
  initialTab = 'overview',
  onOpenSettings,
  onLogout,
  onBack,
  onOpenHome,
}: ManagerControlCenterProps) {
  const [tab, setTab] = useState<ManagerCenterTab>(initialTab);
  const [summary, setSummary] = useState<CenterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingModuleId, setTogglingModuleId] = useState<string | null>(null);
  const [jobsLiveTick, setJobsLiveTick] = useState(0);
  const lastFailToastRef = useRef<string>('');
  const lastHealthToastRef = useRef<string>('');

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await api.getManagerCenterSummary();
      setSummary(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load control center');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const softRefresh = useCallback(() => {
    void load(true);
  }, [load]);

  const live = useControlCenterLive({
    enabled: true,
    onNeedsRefresh: softRefresh,
    onJobFailed: (job) => {
      const key = `${job.id}:${job.status}`;
      if (lastFailToastRef.current === key) return;
      lastFailToastRef.current = key;
      toast.error(`AI job failed: ${job.kind || job.id.slice(0, 8)}`, {
        description: job.errorMessage?.slice(0, 120) || 'Open AI Jobs for retry',
      });
      setJobsLiveTick((n) => n + 1);
      softRefresh();
    },
    onHealthAlert: (health) => {
      const key = `${health.overall}:${health.maintenanceMode ? 1 : 0}`;
      if (lastHealthToastRef.current === key) return;
      lastHealthToastRef.current = key;
      if (health.overall === 'error') {
        toast.error('System health needs attention', {
          description: 'Open the Health tab for details',
        });
      }
    },
    onEvent: (ev) => {
      if (ev.type === 'job:updated' && ev.job) {
        setJobsLiveTick((n) => n + 1);
        setSummary((prev) => {
          if (!prev) return prev;
          const job = ev.job!;
          const row = {
            id: job.id,
            kind: job.kind || 'job',
            status: job.status || 'running',
            progress: job.progress ?? 0,
            phase: job.phase,
            technicianId: job.technicianId,
            createdAt: job.updatedAt || new Date().toISOString(),
            errorMessage: job.errorMessage ?? null,
          };
          const rest = prev.recentJobs.filter((j) => j.id !== row.id);
          const recentJobs = [row, ...rest].slice(0, 12);
          const activeDelta =
            row.status === 'queued' || row.status === 'running'
              ? 1
              : 0;
          // Approximate active count from list presence
          const aiJobsActive = recentJobs.filter(
            (j) => j.status === 'queued' || j.status === 'running'
          ).length;
          return {
            ...prev,
            recentJobs,
            kpis: {
              ...prev.kpis,
              aiJobsActive: Math.max(activeDelta, aiJobsActive),
            },
          };
        });
      }
      if (ev.type === 'health:changed' && ev.health) {
        setSummary((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            health: {
              ...prev.health,
              overall: ev.health!.overall,
              maintenanceMode:
                ev.health!.maintenanceMode ?? prev.health.maintenanceMode,
              critical: (ev.health!.critical || prev.health.critical).map((c) => ({
                id: c.id,
                label: c.label,
                status: (c.status as 'ok' | 'warn' | 'error') || 'ok',
              })),
            },
          };
        });
      }
    },
  });

  useEffect(() => {
    void load();
  }, [load]);

  // Fallback poll only when SSE is not live
  useEffect(() => {
    if (live.connectionState === 'live') return;
    if (tab !== 'overview' && tab !== 'health' && tab !== 'jobs') return;
    const t = setInterval(() => void load(true), 45_000);
    return () => clearInterval(t);
  }, [tab, load, live.connectionState]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const toggleModule = async (moduleId: string, enabled: boolean) => {
    setTogglingModuleId(moduleId);
    try {
      await api.setModuleEnabled(moduleId, enabled);
      toast.success(`${moduleId} ${enabled ? 'enabled' : 'disabled'}`);
      await load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Module update failed');
    } finally {
      setTogglingModuleId(null);
    }
  };

  const warmSession = async () => {
    try {
      await fetch('/api/session/warmup', { credentials: 'include', cache: 'no-store' });
      toast.success('Session & DB path warmed');
      await load(true);
    } catch {
      toast.error('Warmup failed');
    }
  };

  const overallLabel = useMemo(() => {
    if (!summary) return '…';
    if (summary.health.maintenanceMode) return 'Maintenance';
    return summary.health.overall === 'ok'
      ? 'Healthy'
      : summary.health.overall === 'degraded'
        ? 'Degraded'
        : 'Attention';
  }, [summary]);

  return (
    <div className="benz-page benz-page-compact benz-bay-shell min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4 pt-2">
        <div className="flex items-center gap-2 min-w-0">
          {onBack ? (
            <button type="button" className="benz-nav-back !mb-0" onClick={onBack} aria-label="Back">
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <div className="min-w-0">
            <p className="benz-dashboard-eyebrow">Manager Control Center</p>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate">
              {session.dealershipName}
            </h1>
            <p className="text-xs text-benz-secondary">
              {session.name} · single pane of glass
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`status-pill ${liveStatusLabel(live.connectionState).className} inline-flex items-center gap-1.5`}
            title={
              live.lastEventAt
                ? `Last event ${new Date(live.lastEventAt).toLocaleTimeString()}`
                : 'Live stream status'
            }
          >
            <span
              className={`w-2 h-2 rounded-full ${
                live.connectionState === 'live'
                  ? 'bg-emerald-500 animate-pulse'
                  : live.connectionState === 'fallback'
                    ? 'bg-amber-500'
                    : 'bg-benz-muted'
              }`}
            />
            {liveStatusLabel(live.connectionState).text}
          </span>
          <button
            type="button"
            className="secondary-btn h-10 px-3 text-xs font-semibold flex items-center gap-1.5 touch-target-bay"
            onClick={() => {
              live.forceReconnect();
              void load(true);
            }}
            disabled={refreshing || loading}
          >
            {refreshing || loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </button>
          <button
            type="button"
            className="secondary-btn h-10 px-3 text-xs font-semibold touch-target-bay"
            onClick={onOpenSettings}
          >
            <Settings size={14} className="inline mr-1" />
            Settings
          </button>
          <button
            type="button"
            className="secondary-btn h-10 px-3 text-xs font-semibold touch-target-bay"
            onClick={onLogout}
          >
            Sign out
          </button>
        </div>
      </header>

      <nav
        className="flex gap-1 overflow-x-auto pb-2 mb-4 border-b border-benz-border/50"
        aria-label="Control center sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`secondary-btn h-10 px-3 text-xs font-semibold flex items-center gap-1.5 shrink-0 touch-target-bay ${
              tab === t.id ? 'ring-2 ring-benz-blue' : ''
            }`}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      {loading && !summary ? (
        <div className="benz-card p-10 text-center text-sm text-benz-secondary flex items-center justify-center gap-2">
          <Loader2 size={18} className="animate-spin" />
          Loading control center…
        </div>
      ) : null}

      {summary && tab === 'overview' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-2 status-pill ${
                summary.health.overall === 'ok' && !summary.health.maintenanceMode
                  ? 'status-pill-valid'
                  : 'status-pill-warn'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${statusDot(summary.health.overall)}`} />
              System {overallLabel}
            </span>
            {summary.health.maintenanceMode ? (
              <span className="status-pill status-pill-warn flex items-center gap-1">
                <ShieldAlert size={12} />
                Maintenance mode ON
              </span>
            ) : null}
            <span className="text-[11px] text-benz-muted">
              Updated {new Date(summary.generatedAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Repair Orders"
              value={summary.kpis.totalRepairOrders}
              icon={<ClipboardList size={14} />}
            />
            <KpiCard
              label="AI Jobs Today"
              value={summary.kpis.aiJobsToday}
              icon={<Sparkles size={14} />}
              hint={`${summary.kpis.aiJobsActive} active`}
            />
            <KpiCard
              label="Voice (7d)"
              value={summary.kpis.voiceQueriesApprox7d}
              icon={<Phone size={14} />}
              hint={summary.voice.parentEnabled ? 'Voice parent on' : 'Voice parent off'}
            />
            <KpiCard
              label="Modules"
              value={`${summary.kpis.modulesEnabled}/${summary.kpis.modulesTotal}`}
              icon={<Puzzle size={14} />}
              hint={`${summary.kpis.activeTechnicians} active techs`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {summary.health.critical.map((c) => (
              <div
                key={c.id}
                className="benz-card p-3 flex items-center gap-2"
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot(c.status)}`} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{c.label}</div>
                  <div className="text-[10px] text-benz-muted uppercase">{c.status}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="benz-card p-4">
            <div className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Gauge size={16} className="text-benz-blue" />
              Quick actions
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="primary-btn h-11 px-4 text-xs font-semibold touch-target-bay"
                onClick={() => void warmSession()}
              >
                Warm session
              </button>
              <button
                type="button"
                className="secondary-btn h-11 px-4 text-xs font-semibold touch-target-bay"
                onClick={() => setTab('jobs')}
              >
                Open AI Jobs
              </button>
              <button
                type="button"
                className="secondary-btn h-11 px-4 text-xs font-semibold touch-target-bay"
                onClick={() => setTab('modules')}
              >
                Module toggles
              </button>
              <button
                type="button"
                className="secondary-btn h-11 px-4 text-xs font-semibold touch-target-bay"
                onClick={() => setTab('voice')}
              >
                Voice tailoring
              </button>
              {onOpenHome ? (
                <button
                  type="button"
                  className="secondary-btn h-11 px-4 text-xs font-semibold touch-target-bay"
                  onClick={onOpenHome}
                >
                  RO home
                </button>
              ) : (
                <Link href="/" className="secondary-btn h-11 px-4 text-xs font-semibold flex items-center touch-target-bay">
                  RO home
                </Link>
              )}
              <Link
                href="/manager/jobs"
                className="secondary-btn h-11 px-4 text-xs font-semibold flex items-center touch-target-bay"
              >
                Jobs (standalone)
              </Link>
            </div>
            <p className="text-[11px] text-benz-muted mt-3 leading-relaxed">
              Maintenance mode is controlled by Worker env <code>MERLIN_MAINTENANCE_MODE</code> —
              not toggled from the browser for safety.
            </p>
          </div>

          <div className="benz-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Activity size={16} className="text-benz-blue" />
                Recent AI jobs
              </div>
              <button
                type="button"
                className="text-xs text-benz-blue font-semibold"
                onClick={() => setTab('jobs')}
              >
                View all
              </button>
            </div>
            {summary.recentJobs.length === 0 ? (
              <p className="text-xs text-benz-secondary">No recent jobs.</p>
            ) : (
              <ul className="divide-y divide-benz-border/40">
                {summary.recentJobs.slice(0, 6).map((j) => (
                  <li key={j.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-benz-secondary">{j.id.slice(0, 8)}…</span>
                    <span>{j.kind}</span>
                    <span className="status-pill">{j.status}</span>
                    <span className="text-benz-muted tabular-nums">{j.progress}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Queue depth" value={summary.queue.queueDepth} icon={<Cpu size={14} />} />
            <KpiCard
              label="Failed 24h"
              value={summary.queue.failedLast24h}
              icon={<Activity size={14} />}
              hint={`${(summary.queue.errorRate24h * 100).toFixed(0)}% err rate`}
            />
            <KpiCard
              label="Stories"
              value={summary.kpis.warrantyStories}
              icon={<Sparkles size={14} />}
            />
            <KpiCard
              label="Active techs"
              value={summary.kpis.activeTechnicians}
              icon={<Users size={14} />}
            />
          </div>
        </div>
      ) : null}

      {summary && tab === 'jobs' ? (
        <ManagerJobsMonitor
          session={session}
          onOpenSettings={onOpenSettings}
          onLogout={onLogout}
          embedded
          liveRefreshToken={jobsLiveTick}
          liveJobPatches={live.recentJobUpdates}
        />
      ) : null}

      {summary && tab === 'voice' ? (
        <div className="space-y-4">
          <div className="benz-card p-4">
            <div className="text-sm font-semibold mb-2">Voice department matrix</div>
            <p className="text-xs text-benz-secondary mb-3">
              Parent voice agent: {summary.voice.parentEnabled ? 'enabled' : 'disabled'}. Department
              SKUs require parent + domain module.
            </p>
            <ul className="space-y-2">
              {summary.voice.departments.map((d) => (
                <li
                  key={d.department}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-benz-border/50 px-3 py-2 text-xs"
                >
                  <span className="font-semibold capitalize">{d.department}</span>
                  <span className="font-mono text-benz-muted">{d.moduleId}</span>
                  <span className={d.enabled ? 'text-emerald-600' : 'text-amber-600'}>
                    {d.enabled ? 'On' : 'Off'}
                  </span>
                  <span className="text-benz-secondary">
                    {d.tailoringActive
                      ? `Tailoring v${d.tailoringVersion}`
                      : 'Default persona'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-benz-muted mt-3">
              Tablet queries (7d): {summary.kpis.voiceQueriesApprox7d}. Toggle SKUs under Modules.
            </p>
          </div>
          <DepartmentTailoringPanel />
        </div>
      ) : null}

      {summary && tab === 'modules' ? (
        <div className="benz-card p-4">
          <div className="text-sm font-semibold mb-1">Module entitlements</div>
          <p className="text-xs text-benz-secondary mb-4">
            Enable or disable rooftop product modules. Core story is always on.
          </p>
          <ul className="space-y-2" aria-label="Product modules">
            {summary.modules.map((mod) => {
              const busy = togglingModuleId === mod.moduleId;
              const forced = mod.source === 'force_env';
              return (
                <li
                  key={mod.moduleId}
                  className="flex items-start justify-between gap-3 rounded-lg border border-benz-border/50 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{mod.name}</div>
                    <div className="text-xs text-benz-secondary mt-0.5 leading-relaxed">
                      {mod.description}
                    </div>
                    <div className="text-[11px] text-benz-muted mt-1">
                      {mod.moduleId} · source {mod.source}
                      {forced ? ' · env override' : ''}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span
                      className={`status-pill ${
                        mod.enabled ? 'status-pill-valid' : 'status-pill-warn'
                      }`}
                    >
                      {mod.enabled ? 'On' : 'Off'}
                    </span>
                    <button
                      type="button"
                      className="secondary-btn h-9 px-3 text-xs font-semibold"
                      disabled={busy || forced}
                      onClick={() => void toggleModule(mod.moduleId, !mod.enabled)}
                    >
                      {busy ? '…' : mod.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {summary && tab === 'health' ? (
        <div className="space-y-4">
          <div className="benz-card p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="text-sm font-semibold">System health</div>
              <span className="status-pill">
                {summary.health.overall}
                {summary.health.maintenanceMode ? ' · maintenance' : ''}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(summary.health.services).map(([name, svc]) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-2 rounded-lg border border-benz-border/40 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(svc.status)}`} />
                    <span className="font-mono truncate">{name}</span>
                  </div>
                  <span className="text-benz-muted tabular-nums">
                    {svc.latencyMs != null ? `${svc.latencyMs}ms` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="benz-card p-4">
            <div className="text-sm font-semibold mb-2">Queue isolate metrics</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>Enqueued: <strong>{summary.queueMetrics.enqueued}</strong></div>
              <div>Completed: <strong>{summary.queueMetrics.completed}</strong></div>
              <div>Failed: <strong>{summary.queueMetrics.failed}</strong></div>
              <div>Inline: <strong>{summary.queueMetrics.inlineFallback}</strong></div>
            </div>
            <p className="text-[11px] text-benz-muted mt-3 leading-relaxed">
              Isolate metrics reset on Worker restart. D1 depth: queued {summary.queue.queued} ·
              running {summary.queue.running}.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
