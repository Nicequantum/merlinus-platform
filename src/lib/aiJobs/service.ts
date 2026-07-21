/**
 * P1-1 — Create / update / map AiJob rows (tenant-scoped via RLS).
 */
import 'server-only';

import { getRlsDb } from '@/lib/apex/rlsContext';
import { decryptSensitiveText, encryptSensitiveText } from '@/lib/encryption';
import type { AiJobKind, AiJobPublicView, AiJobStatus } from '@/lib/aiJobs/types';

export async function createAiJob(input: {
  dealershipId: string;
  technicianId: string;
  kind: AiJobKind | string;
  entityType?: string | null;
  entityId?: string | null;
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
    select: { id: true },
  });
  return row;
}

export async function markAiJobRunning(jobId: string): Promise<void> {
  await getRlsDb().aiJob.updateMany({
    where: { id: jobId },
    data: {
      status: 'running',
      progress: 5,
      startedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function markAiJobProgress(jobId: string, progress: number): Promise<void> {
  const p = Math.max(0, Math.min(99, Math.round(progress)));
  await getRlsDb().aiJob.updateMany({
    where: { id: jobId, status: 'running' },
    data: { progress: p, updatedAt: new Date() },
  });
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
}

export async function markAiJobFailed(jobId: string, message: string): Promise<void> {
  await getRlsDb().aiJob.updateMany({
    where: { id: jobId },
    data: {
      status: 'failed',
      errorMessage: message.slice(0, 500),
      finishedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function getAiJobForTechnician(
  jobId: string,
  technicianId: string
): Promise<AiJobPublicView | null> {
  const row = await getRlsDb().aiJob.findFirst({
    where: { id: jobId, technicianId },
  });
  if (!row) return null;

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
  };
}
