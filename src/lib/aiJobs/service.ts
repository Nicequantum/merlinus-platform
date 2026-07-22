/**
 * P1-1 — Create / update / map AiJob rows (tenant-scoped via RLS).
 * Publishes luxury job events for SSE subscribers.
 */
import 'server-only';

import { getRlsDb } from '@/lib/apex/rlsContext';
import { decryptSensitiveText, encryptSensitiveText } from '@/lib/encryption';
import type { AiJobKind, AiJobPublicView, AiJobStatus } from '@/lib/aiJobs/types';
import {
  luxuryPhaseFromProgress,
  publishJobEvent,
} from '@/lib/queue/jobEventsHub';
import {
  publishJobUpdatedToCenter,
  registerJobDealership,
} from '@/lib/manager/controlCenterHub';

function emitJobUpdate(
  jobId: string,
  status: string,
  progress: number,
  extra?: {
    errorMessage?: string | null;
    kind?: string;
    result?: unknown;
    dealershipId?: string | null;
    technicianId?: string;
    entityId?: string | null;
  }
): void {
  const phase = luxuryPhaseFromProgress(status, progress);
  publishJobEvent({
    type: 'job.update',
    jobId,
    status,
    progress,
    phase,
    errorMessage: extra?.errorMessage,
    kind: extra?.kind,
    result: extra?.result,
  });
  // Fan-out to Manager Control Center live stream (same isolate)
  publishJobUpdatedToCenter({
    dealershipId: extra?.dealershipId,
    jobId,
    kind: extra?.kind,
    status,
    progress,
    phase,
    technicianId: extra?.technicianId,
    errorMessage: extra?.errorMessage,
    entityId: extra?.entityId,
  });
}

export async function createAiJob(input: {
  dealershipId: string;
  technicianId: string;
  kind: AiJobKind | string;
  entityType?: string | null;
  entityId?: string | null;
  priority?: 'low' | 'normal' | 'high';
}): Promise<{ id: string }> {
  const row = await getRlsDb().aiJob.create({
    data: {
      dealershipId: input.dealershipId,
      technicianId: input.technicianId,
      kind: input.kind,
      status: 'queued',
      progress: 0,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
    select: { id: true, kind: true },
  });
  registerJobDealership(row.id, input.dealershipId);
  emitJobUpdate(row.id, 'queued', 0, {
    kind: row.kind,
    dealershipId: input.dealershipId,
    technicianId: input.technicianId,
    entityId: input.entityId ?? null,
  });
  return { id: row.id };
}

export async function markAiJobRunning(jobId: string): Promise<void> {
  await getRlsDb().aiJob.updateMany({
    where: { id: jobId, status: { in: ['queued', 'running'] } },
    data: {
      status: 'running',
      progress: 5,
      startedAt: new Date(),
      updatedAt: new Date(),
      errorMessage: null,
    },
  });
  emitJobUpdate(jobId, 'running', 5);
}

export async function markAiJobProgress(jobId: string, progress: number): Promise<void> {
  const p = Math.max(0, Math.min(99, Math.round(progress)));
  await getRlsDb().aiJob.updateMany({
    where: { id: jobId, status: 'running' },
    data: { progress: p, updatedAt: new Date() },
  });
  emitJobUpdate(jobId, 'running', p);
}

export async function markAiJobSucceeded(
  jobId: string,
  result: unknown
): Promise<void> {
  const payload = encryptSensitiveText(JSON.stringify(result ?? {}));
  await getRlsDb().aiJob.updateMany({
    where: { id: jobId },
    data: {
      status: 'succeeded',
      progress: 100,
      resultEncrypted: payload,
      errorMessage: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  emitJobUpdate(jobId, 'succeeded', 100, { result: result ?? {} });
}

export async function markAiJobFailed(jobId: string, message: string): Promise<void> {
  const errorMessage = message.slice(0, 500);
  await getRlsDb().aiJob.updateMany({
    where: { id: jobId },
    data: {
      status: 'failed',
      errorMessage,
      finishedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  emitJobUpdate(jobId, 'failed', 0, { errorMessage });
}

export async function markAiJobCancelled(jobId: string): Promise<boolean> {
  const res = await getRlsDb().aiJob.updateMany({
    where: { id: jobId, status: { in: ['queued', 'running'] } },
    data: {
      status: 'cancelled',
      errorMessage: 'Cancelled by manager',
      finishedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  if (res.count > 0) {
    emitJobUpdate(jobId, 'cancelled', 0, { errorMessage: 'Cancelled by manager' });
    return true;
  }
  return false;
}

export async function getAiJobForTechnician(
  jobId: string,
  technicianId: string
): Promise<AiJobPublicView | null> {
  const row = await getRlsDb().aiJob.findFirst({
    where: { id: jobId, technicianId },
  });
  if (!row) return null;
  return mapAiJobRow(row);
}

export async function getAiJobForDealership(
  jobId: string,
  dealershipId: string
): Promise<AiJobPublicView | null> {
  const row = await getRlsDb().aiJob.findFirst({
    where: { id: jobId, dealershipId },
  });
  if (!row) return null;
  return mapAiJobRow(row);
}

function mapAiJobRow(row: {
  id: string;
  kind: string;
  status: string;
  progress: number;
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
  resultEncrypted: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  technicianId?: string;
}): AiJobPublicView {
  let result: unknown | null = null;
  if (row.status === 'succeeded' && row.resultEncrypted) {
    try {
      result = JSON.parse(decryptSensitiveText(row.resultEncrypted) || '{}');
    } catch {
      result = null;
    }
  }

  return {
    id: row.id,
    kind: row.kind,
    status: row.status as AiJobStatus,
    progress: row.progress,
    entityType: row.entityType,
    entityId: row.entityId,
    errorMessage: row.errorMessage,
    result,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    phase: luxuryPhaseFromProgress(row.status, row.progress),
    technicianId: row.technicianId,
  };
}

export interface ListDealershipJobsFilter {
  dealershipId: string;
  status?: string;
  technicianId?: string;
  entityId?: string;
  kind?: string;
  take?: number;
}

export async function listDealershipAiJobs(
  filter: ListDealershipJobsFilter
): Promise<AiJobPublicView[]> {
  const take = Math.min(100, Math.max(1, filter.take ?? 40));
  const rows = await getRlsDb().aiJob.findMany({
    where: {
      dealershipId: filter.dealershipId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.technicianId ? { technicianId: filter.technicianId } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map((r) => mapAiJobRow(r));
}

export interface AiJobQueueHealthStats {
  queued: number;
  running: number;
  failedLast24h: number;
  succeededLast24h: number;
  /** failed / (failed + succeeded) over last 24h, 0–1 */
  errorRate24h: number;
  oldestQueuedAt: string | null;
  oldestQueuedAgeMs: number | null;
  queueDepth: number;
}

function toHealthStats(input: {
  queued: number;
  running: number;
  failedLast24h: number;
  succeededLast24h: number;
  oldestQueuedAt: string | null;
  oldestQueuedAgeMs: number | null;
}): AiJobQueueHealthStats {
  const terminal = input.failedLast24h + input.succeededLast24h;
  return {
    ...input,
    errorRate24h: terminal === 0 ? 0 : input.failedLast24h / terminal,
    queueDepth: input.queued + input.running,
  };
}

/** Aggregate stats for health + manager dashboard (single rooftop). */
export async function getDealershipJobHealthStats(
  dealershipId: string
): Promise<AiJobQueueHealthStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const db = getRlsDb();
  const [queued, running, failedLast24h, succeededLast24h, oldestQueued] = await Promise.all([
    db.aiJob.count({ where: { dealershipId, status: 'queued' } }),
    db.aiJob.count({ where: { dealershipId, status: 'running' } }),
    db.aiJob.count({
      where: { dealershipId, status: 'failed', createdAt: { gte: since } },
    }),
    db.aiJob.count({
      where: { dealershipId, status: 'succeeded', createdAt: { gte: since } },
    }),
    db.aiJob.findFirst({
      where: { dealershipId, status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  return toHealthStats({
    queued,
    running,
    failedLast24h,
    succeededLast24h,
    oldestQueuedAt: oldestQueued?.createdAt?.toISOString() ?? null,
    oldestQueuedAgeMs: oldestQueued
      ? Date.now() - oldestQueued.createdAt.getTime()
      : null,
  });
}

/**
 * Platform-wide AI job queue depth / error rate for /api/health.
 * Uses app-layer counts (D1 has no native CF Queue depth API here).
 */
export async function getGlobalAiJobQueueHealth(): Promise<AiJobQueueHealthStats> {
  const { withRlsBypass } = await import('@/lib/apex/rlsContext');
  return withRlsBypass(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const db = getRlsDb();
    const [queued, running, failedLast24h, succeededLast24h, oldestQueued] = await Promise.all([
      db.aiJob.count({ where: { status: 'queued' } }),
      db.aiJob.count({ where: { status: 'running' } }),
      db.aiJob.count({ where: { status: 'failed', createdAt: { gte: since } } }),
      db.aiJob.count({ where: { status: 'succeeded', createdAt: { gte: since } } }),
      db.aiJob.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    return toHealthStats({
      queued,
      running,
      failedLast24h,
      succeededLast24h,
      oldestQueuedAt: oldestQueued?.createdAt?.toISOString() ?? null,
      oldestQueuedAgeMs: oldestQueued
        ? Date.now() - oldestQueued.createdAt.getTime()
        : null,
    });
  });
}
