'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  RotateCcw,
  Ban,
  Activity,
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { technicianFriendlyJobError } from '@/lib/aiJobClient';
import type { TechnicianSession } from '@/types';

interface ManagerJobsMonitorProps {
  session: TechnicianSession;
  onOpenSettings: () => void;
  onLogout: () => void;
  onBack?: () => void;
  /** Hide chrome when nested in Manager Control Center */
  embedded?: boolean;
  /** Bump to soft-refresh list (SSE job events) */
  liveRefreshToken?: number;
  /** Optimistic patches from Control Center live stream */
  liveJobPatches?: Array<{
    id: string;
    kind?: string;
    status?: string;
    progress?: number;
    phase?: string;
    technicianId?: string;
    errorMessage?: string | null;
  }>;
}

type JobRow = {
  id: string;
  kind: string;
  status: string;
  progress: number;
  phase?: string;
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  technicianId?: string;
};

type StatusFilter = 'all' | 'active' | 'queued' | 'running' | 'failed' | 'succeeded' | 'cancelled';

function phaseLabel(phase?: string, status?: string): string {
  const p = phase || status || '';
  switch (p) {
    case 'queued':
      return 'Queued';
    case 'processing':
    case 'running':
      return 'Processing';
    case 'ai_thinking':
      return 'AI Thinking';
    case 'complete':
    case 'succeeded':
      return 'Complete';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return p || '—';
  }
}

function statusPillClass(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'status-pill status-pill-valid';
    case 'failed':
      return 'status-pill bg-red-500/15 text-red-600 border-red-500/30';
    case 'cancelled':
      return 'status-pill status-pill-warn';
    case 'running':
      return 'status-pill bg-benz-blue/15 text-benz-blue border-benz-blue/30';
    case 'queued':
      return 'status-pill bg-amber-500/15 text-amber-700 border-amber-500/30';
    default:
      return 'status-pill';
  }
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function ManagerJobsMonitor({
  session,
  onOpenSettings,
  onBack,
  embedded = false,
  liveRefreshToken = 0,
  liveJobPatches,
}: ManagerJobsMonitorProps) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [entityFilter, setEntityFilter] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [health, setHealth] = useState<{
    queued: number;
    running: number;
    failedLast24h: number;
    errorRate24h: number;
    queueDepth: number;
    oldestQueuedAgeMs: number | null;
  } | null>(null);
  const [mfaNotice, setMfaNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listManagerAiJobs({
        status: statusFilter,
        technicianId: techFilter.trim() || undefined,
        entityId: entityFilter.trim() || undefined,
        take: 50,
      });
      setJobs(data.jobs);
      setHealth({
        queued: data.health.queued,
        running: data.health.running,
        failedLast24h: data.health.failedLast24h,
        errorRate24h: data.health.errorRate24h,
        queueDepth: data.health.queueDepth,
        oldestQueuedAgeMs: data.health.oldestQueuedAgeMs,
      });
      try {
        const mfa = await api.mfaStatus();
        if (!mfa.mfaEnabled) {
          setMfaNotice(
            mfa.enforcementEnabled
              ? 'MFA Required for Managers — complete setup under Settings before production.'
              : 'MFA recommended for Managers — enable under Settings (pilot: optional).'
          );
        } else {
          setMfaNotice(
            `MFA active · ${mfa.backupCodesRemaining} backup codes remaining`
          );
        }
      } catch {
        setMfaNotice(null);
      }
    } catch (error) {
      const msg =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to load AI jobs';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, techFilter, entityFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // SSE-driven soft refresh from Control Center
  useEffect(() => {
    if (!liveRefreshToken) return;
    void load();
  }, [liveRefreshToken, load]);

  // Merge live patches optimistically between full reloads
  useEffect(() => {
    if (!liveJobPatches?.length) return;
    setJobs((prev) => {
      let next = [...prev];
      for (const p of liveJobPatches) {
        const idx = next.findIndex((j) => j.id === p.id);
        if (idx >= 0) {
          next[idx] = {
            ...next[idx]!,
            kind: p.kind || next[idx]!.kind,
            status: p.status || next[idx]!.status,
            progress: p.progress ?? next[idx]!.progress,
            phase: p.phase || next[idx]!.phase,
            errorMessage:
              p.errorMessage !== undefined ? p.errorMessage : next[idx]!.errorMessage,
            technicianId: p.technicianId || next[idx]!.technicianId,
          };
        } else if (p.status === 'queued' || p.status === 'running') {
          next = [
            {
              id: p.id,
              kind: p.kind || 'job',
              status: p.status || 'queued',
              progress: p.progress ?? 0,
              phase: p.phase,
              entityType: null,
              entityId: null,
              errorMessage: p.errorMessage ?? null,
              startedAt: null,
              finishedAt: null,
              createdAt: new Date().toISOString(),
              technicianId: p.technicianId,
            },
            ...next,
          ].slice(0, 50);
        }
      }
      return next;
    });
  }, [liveJobPatches]);

  // Light auto-refresh while active jobs exist (fallback when not SSE-driven)
  useEffect(() => {
    if (liveRefreshToken > 0) return; // live stream owns refresh cadence
    const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!hasActive) return;
    const t = setInterval(() => void load(), 8_000);
    return () => clearInterval(t);
  }, [jobs, load, liveRefreshToken]);

  const onRetry = async (jobId: string) => {
    setBusyId(jobId);
    try {
      const res = await api.retryManagerAiJob(jobId);
      toast.success(`Re-queued as ${shortId(res.jobId)}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Retry failed');
    } finally {
      setBusyId(null);
    }
  };

  const onCancel = async (jobId: string) => {
    setBusyId(jobId);
    try {
      const res = await api.cancelManagerAiJob(jobId);
      if (res.ok) toast.success('Job cancelled');
      else toast.message(res.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Cancel failed');
    } finally {
      setBusyId(null);
    }
  };

  const oldestLabel = useMemo(() => {
    if (!health?.oldestQueuedAgeMs) return 'none';
    return formatAge(new Date(Date.now() - health.oldestQueuedAgeMs).toISOString());
  }, [health]);

  return (
    <div className={embedded ? 'space-y-4' : 'benz-dashboard-layout benz-page-compact'}>
      {!embedded ? (
        <div className="relative pt-2 mb-5">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="absolute top-2 left-0 benz-icon-btn touch-target"
              aria-label="Back"
            >
              <ArrowLeft size={22} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenSettings}
            className="absolute top-2 right-0 secondary-btn h-9 px-3 text-xs"
          >
            Settings
          </button>
          <p className="benz-dashboard-eyebrow text-center">AI Operations</p>
          <h1 className="text-xl font-bold tracking-tight text-center mt-1">Job Monitor</h1>
          <p className="text-xs text-benz-secondary mt-2 text-center">
            {session.dealershipName} · durable async AI jobs
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">AI Jobs</h2>
            <p className="text-xs text-benz-secondary">Active + recent durable queue work</p>
          </div>
          <button
            type="button"
            className="secondary-btn h-9 px-3 text-xs font-semibold flex items-center gap-1.5"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      )}

      {mfaNotice ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 mb-4 text-xs text-center leading-relaxed">
          {mfaNotice}
        </div>
      ) : null}

      {health ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="stat-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-benz-secondary mb-1">
              Queue depth
            </div>
            <div className="text-xl font-bold">{health.queueDepth}</div>
            <div className="text-[11px] text-benz-secondary mt-0.5">
              {health.queued} queued · {health.running} running
            </div>
          </div>
          <div className="stat-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-benz-secondary mb-1">
              Failed (24h)
            </div>
            <div className="text-xl font-bold text-red-600">{health.failedLast24h}</div>
            <div className="text-[11px] text-benz-secondary mt-0.5">
              {(health.errorRate24h * 100).toFixed(0)}% error rate
            </div>
          </div>
          <div className="stat-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-benz-secondary mb-1">
              Oldest queued
            </div>
            <div className="text-xl font-bold">{oldestLabel}</div>
          </div>
          <div className="stat-card p-3 flex flex-col justify-center">
            <button
              type="button"
              className="secondary-btn h-10 text-xs font-semibold flex items-center justify-center gap-2"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
          </div>
        </div>
      ) : null}

      <div className="benz-card p-4 mb-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
          <Filter size={14} className="text-benz-blue" />
          Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-xs text-benz-secondary">
            Status
            <select
              className="mt-1 w-full h-10 rounded-lg border border-benz-border bg-transparent px-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All recent</option>
              <option value="active">Active (queued + running)</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="failed">Failed</option>
              <option value="succeeded">Succeeded</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="block text-xs text-benz-secondary">
            Line / entity ID (RO line)
            <input
              className="mt-1 w-full h-10 rounded-lg border border-benz-border bg-transparent px-3 text-sm"
              placeholder="Filter by entity id…"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
            />
          </label>
          <label className="block text-xs text-benz-secondary">
            Technician ID
            <input
              className="mt-1 w-full h-10 rounded-lg border border-benz-border bg-transparent px-3 text-sm"
              placeholder="Filter by technician…"
              value={techFilter}
              onChange={(e) => setTechFilter(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="benz-card p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-benz-border/60">
          <Activity size={16} className="text-benz-blue" />
          <span className="text-sm font-semibold">Jobs</span>
          <span className="text-xs text-benz-secondary ml-auto">{jobs.length} shown</span>
        </div>

        {loading && jobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-benz-secondary flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading jobs…
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-benz-secondary">
            No AI jobs match these filters.
          </div>
        ) : (
          <ul className="divide-y divide-benz-border/50">
            {jobs.map((job) => {
              const canRetry = job.status === 'failed' || job.status === 'cancelled';
              const canCancel = job.status === 'queued' || job.status === 'running';
              const busy = busyId === job.id;
              return (
                <li key={job.id} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={statusPillClass(job.status)}>
                          {phaseLabel(job.phase, job.status)}
                        </span>
                        <span className="text-xs font-mono text-benz-secondary">
                          {shortId(job.id)}
                        </span>
                        <span className="text-xs text-benz-secondary">{job.kind}</span>
                      </div>
                      <div className="text-xs text-benz-secondary leading-relaxed">
                        Tech {job.technicianId ? shortId(job.technicianId) : '—'}
                        {job.entityId ? ` · entity ${shortId(job.entityId)}` : ''}
                        {` · age ${formatAge(job.createdAt)}`}
                        {job.status === 'running' || job.status === 'queued'
                          ? ` · ${job.progress}%`
                          : ''}
                      </div>
                      {job.errorMessage ? (
                        <p className="text-xs text-red-600 mt-1.5 leading-relaxed">
                          {technicianFriendlyJobError(job.errorMessage)}
                        </p>
                      ) : null}
                      {(job.status === 'running' || job.status === 'queued') && (
                        <div className="mt-2 h-1.5 rounded-full bg-benz-border/40 overflow-hidden max-w-xs">
                          <div
                            className="h-full bg-benz-blue transition-all duration-500"
                            style={{ width: `${Math.max(4, Math.min(100, job.progress))}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {canRetry ? (
                        <button
                          type="button"
                          className="secondary-btn h-9 px-3 text-xs font-semibold flex items-center gap-1.5"
                          disabled={busy}
                          onClick={() => void onRetry(job.id)}
                        >
                          {busy ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <RotateCcw size={13} />
                          )}
                          Retry
                        </button>
                      ) : null}
                      {canCancel ? (
                        <button
                          type="button"
                          className="secondary-btn h-9 px-3 text-xs font-semibold flex items-center gap-1.5 text-red-600"
                          disabled={busy}
                          onClick={() => void onCancel(job.id)}
                        >
                          {busy ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Ban size={13} />
                          )}
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
