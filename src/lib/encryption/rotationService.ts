/**
 * Encryption key rotation — status, begin (guided dual-key), background re-encrypt.
 * Keys themselves live in Worker secrets; this tracks progress + generates candidate keys.
 */
import 'server-only';

import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import {
  getEncryptionKeyStatus,
  generateDataEncryptionKey,
  fingerprintSecret,
  isDualKeyRotationActive,
  getPrimaryKeyFingerprint,
  getPreviousKeyFingerprint,
  reencryptCiphertextWithCurrentKey,
} from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { scheduleBackgroundWork } from '@/lib/aiJobs/schedule';

export type RotationStatus =
  | 'pending_env'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface EncryptionRotationDto {
  id: string;
  status: RotationStatus;
  primaryFingerprint: string;
  previousFingerprint: string;
  targetFingerprint: string;
  totalRecords: number;
  processedRecords: number;
  updatedRecords: number;
  failedRecords: number;
  currentTable: string;
  progressPercent: number;
  cancelRequested: boolean;
  errorMessage: string | null;
  startedByTechnicianId: string | null;
  startedAt: string;
  finishedAt: string | null;
  dualKeyActive: boolean;
  liveKeyStatus: ReturnType<typeof getEncryptionKeyStatus>;
}

/** Tables/columns walked during re-encrypt (PII ciphertext fields). */
export const REENCRYPT_TABLE_PLAN: Array<{
  table: string;
  idField: string;
  columns: string[];
}> = [
  {
    table: 'repairOrder',
    idField: 'id',
    columns: [
      'vinEncrypted',
      'customerNameEncrypted',
      'complaintsEncrypted',
      'xentryOcrTextsEncrypted',
      'serviceAdvisorNameEncrypted',
      'roNumberEncrypted',
    ],
  },
  {
    table: 'repairLine',
    idField: 'id',
    columns: [
      'descriptionEncrypted',
      'customerConcernEncrypted',
      'technicianNotesEncrypted',
      'xentryOcrTextsEncrypted',
      'extractedDataEncrypted',
      'warrantyStoryEncrypted',
      'storyQualityAuditEncrypted',
      'storyCertifiedByNameEncrypted',
    ],
  },
  {
    table: 'serviceAdvisor',
    idField: 'id',
    columns: ['displayNameEncrypted'],
  },
  {
    table: 'aiJob',
    idField: 'id',
    columns: ['resultEncrypted'],
  },
];

const BATCH_SIZE = Math.max(10, Number(process.env.REENCRYPT_BATCH_SIZE ?? 40));

function mapDto(
  row: {
    id: string;
    status: string;
    primaryFingerprint: string;
    previousFingerprint: string;
    targetFingerprint: string;
    totalRecords: number;
    processedRecords: number;
    updatedRecords: number;
    failedRecords: number;
    currentTable: string;
    cancelRequested: boolean;
    errorMessage: string | null;
    startedByTechnicianId: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  }
): EncryptionRotationDto {
  const total = Math.max(0, row.totalRecords);
  const processed = Math.max(0, row.processedRecords);
  const progressPercent =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : row.status === 'completed' ? 100 : 0;
  return {
    id: row.id,
    status: row.status as RotationStatus,
    primaryFingerprint: row.primaryFingerprint,
    previousFingerprint: row.previousFingerprint,
    targetFingerprint: row.targetFingerprint,
    totalRecords: row.totalRecords,
    processedRecords: row.processedRecords,
    updatedRecords: row.updatedRecords,
    failedRecords: row.failedRecords,
    currentTable: row.currentTable,
    progressPercent,
    cancelRequested: row.cancelRequested,
    errorMessage: row.errorMessage,
    startedByTechnicianId: row.startedByTechnicianId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    dualKeyActive: isDualKeyRotationActive(),
    liveKeyStatus: getEncryptionKeyStatus(),
  };
}

export async function getActiveOrLatestRotation(): Promise<EncryptionRotationDto | null> {
  return withRlsBypass(async () => {
    const row = await getRlsDb().encryptionRotation.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return row ? mapDto(row) : null;
  });
}

export async function getRotationStatusBundle(): Promise<{
  keys: ReturnType<typeof getEncryptionKeyStatus>;
  rotation: EncryptionRotationDto | null;
  canStartReencrypt: boolean;
  instructions: string[];
}> {
  const keys = getEncryptionKeyStatus();
  const rotation = await getActiveOrLatestRotation();
  const canStartReencrypt =
    keys.dualKeyActive &&
    (!rotation ||
      rotation.status === 'pending_env' ||
      rotation.status === 'cancelled' ||
      rotation.status === 'failed' ||
      rotation.status === 'completed');

  const instructions = [
    '1. Backup the database before any key change.',
    '2. Click Begin rotation to generate a new key (shown once).',
    '3. Set Worker secrets: DATA_ENCRYPTION_KEY_PREVIOUS=<old key>, DATA_ENCRYPTION_KEY=<new key>.',
    '4. Deploy/restart the Worker so dual-key is live.',
    '5. Click Start re-encryption to rewrite ciphertext under the new primary key.',
    '6. After 100% complete and validation, remove DATA_ENCRYPTION_KEY_PREVIOUS.',
  ];

  return { keys, rotation, canStartReencrypt, instructions };
}

/**
 * Begin guided rotation: capture fingerprints, generate new key (returned once).
 * Does not mutate Worker secrets — operator must deploy dual-key env.
 */
export async function beginEncryptionRotation(input: {
  technicianId: string;
  dealershipId: string;
}): Promise<{
  rotation: EncryptionRotationDto;
  /** Shown once — store as DATA_ENCRYPTION_KEY after setting PREVIOUS=current */
  newKey: string;
  previousKeyFingerprint: string;
  newKeyFingerprint: string;
}> {
  const keys = getEncryptionKeyStatus();
  if (keys.dualKeyActive) {
    throw new Error(
      'Dual-key is already active. Finish or cancel the current re-encrypt before generating another key.'
    );
  }

  const active = await getActiveOrLatestRotation();
  if (active && (active.status === 'running' || active.status === 'pending_env')) {
    throw new Error('A rotation is already in progress. Cancel it first or complete re-encryption.');
  }

  const newKey = generateDataEncryptionKey();
  const newKeyFingerprint = fingerprintSecret(newKey);
  const previousKeyFingerprint = keys.primaryFingerprint;

  const row = await withRlsBypass(async () =>
    getRlsDb().encryptionRotation.create({
      data: {
        status: 'pending_env',
        primaryFingerprint: previousKeyFingerprint,
        previousFingerprint: previousKeyFingerprint,
        targetFingerprint: newKeyFingerprint,
        startedByTechnicianId: input.technicianId,
      },
    })
  );

  try {
    await writeAuditedAccess({
      action: 'encryption.rotation_begin',
      dealershipId: input.dealershipId,
      technicianId: input.technicianId,
      entityType: 'encryptionRotation',
      entityId: row.id,
      metadata: {
        previousFingerprint: previousKeyFingerprint,
        targetFingerprint: newKeyFingerprint,
      },
    });
  } catch {
    // best-effort
  }

  logger.info('encryption.rotation_begin', {
    rotationId: row.id,
    previousFingerprint: previousKeyFingerprint,
    targetFingerprint: newKeyFingerprint,
  });

  return {
    rotation: mapDto(row),
    newKey,
    previousKeyFingerprint,
    newKeyFingerprint,
  };
}

export async function startReencryptPass(input: {
  technicianId: string;
  dealershipId: string;
  rotationId?: string;
}): Promise<EncryptionRotationDto> {
  if (!isDualKeyRotationActive()) {
    throw new Error(
      'Dual-key not active. Deploy DATA_ENCRYPTION_KEY_PREVIOUS (old) and DATA_ENCRYPTION_KEY (new) first.'
    );
  }

  const live = getEncryptionKeyStatus();
  const row = await withRlsBypass(async () => {
    const db = getRlsDb();
    let rotation = input.rotationId
      ? await db.encryptionRotation.findUnique({ where: { id: input.rotationId } })
      : await db.encryptionRotation.findFirst({ orderBy: { createdAt: 'desc' } });

    if (!rotation) {
      rotation = await db.encryptionRotation.create({
        data: {
          status: 'running',
          primaryFingerprint: live.primaryFingerprint,
          previousFingerprint: live.previousFingerprint || '',
          targetFingerprint: live.primaryFingerprint,
          startedByTechnicianId: input.technicianId,
          cancelRequested: false,
        },
      });
    } else {
      if (rotation.status === 'running') {
        throw new Error('Re-encryption is already running');
      }
      rotation = await db.encryptionRotation.update({
        where: { id: rotation.id },
        data: {
          status: 'running',
          primaryFingerprint: live.primaryFingerprint,
          previousFingerprint: live.previousFingerprint || '',
          targetFingerprint: live.primaryFingerprint,
          processedRecords: 0,
          updatedRecords: 0,
          failedRecords: 0,
          totalRecords: 0,
          currentTable: REENCRYPT_TABLE_PLAN[0]?.table || '',
          cursorId: '',
          cancelRequested: false,
          errorMessage: null,
          finishedAt: null,
          startedByTechnicianId: input.technicianId,
          startedAt: new Date(),
        },
      });
    }
    return rotation;
  });

  try {
    await writeAuditedAccess({
      action: 'encryption.rotation_reencrypt_start',
      dealershipId: input.dealershipId,
      technicianId: input.technicianId,
      entityType: 'encryptionRotation',
      entityId: row.id,
      metadata: {
        primaryFingerprint: live.primaryFingerprint,
        previousFingerprint: live.previousFingerprint,
      },
    });
  } catch {
    // best-effort
  }

  await scheduleBackgroundWork(`encryption.reencrypt:${row.id}`, async () => {
    await runReencryptRotationJob(row.id);
  });

  return mapDto(row);
}

export async function cancelEncryptionRotation(input: {
  technicianId: string;
  dealershipId: string;
  rotationId?: string;
}): Promise<EncryptionRotationDto> {
  const row = await withRlsBypass(async () => {
    const db = getRlsDb();
    const rotation = input.rotationId
      ? await db.encryptionRotation.findUnique({ where: { id: input.rotationId } })
      : await db.encryptionRotation.findFirst({
          where: { status: { in: ['pending_env', 'running'] } },
          orderBy: { createdAt: 'desc' },
        });
    if (!rotation) throw new Error('No active rotation to cancel');
    if (rotation.status === 'running') {
      return db.encryptionRotation.update({
        where: { id: rotation.id },
        data: { cancelRequested: true, updatedAt: new Date() },
      });
    }
    return db.encryptionRotation.update({
      where: { id: rotation.id },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        cancelRequested: true,
      },
    });
  });

  try {
    await writeAuditedAccess({
      action: 'encryption.rotation_cancel',
      dealershipId: input.dealershipId,
      technicianId: input.technicianId,
      entityType: 'encryptionRotation',
      entityId: row.id,
      metadata: { status: row.status },
    });
  } catch {
    // best-effort
  }

  return mapDto(row);
}

async function estimateTotalRecords(): Promise<number> {
  return withRlsBypass(async () => {
    const db = getRlsDb();
    let total = 0;
    try {
      total += await db.repairOrder.count();
    } catch {
      /* column may miss */
    }
    try {
      total += await db.repairLine.count();
    } catch {
      /* */
    }
    try {
      total += await db.serviceAdvisor.count();
    } catch {
      /* */
    }
    try {
      total += await db.aiJob.count();
    } catch {
      /* */
    }
    return total;
  });
}

/**
 * Process re-encryption until complete/cancelled. Safe to resume.
 */
export async function runReencryptRotationJob(rotationId: string): Promise<void> {
  const total = await estimateTotalRecords();
  await withRlsBypass(async () => {
    await getRlsDb().encryptionRotation.update({
      where: { id: rotationId },
      data: { totalRecords: total, status: 'running' },
    });
  });

  let tableIndex = 0;
  let cursorId = '';

  // Restore cursor from DB if resuming
  const existing = await withRlsBypass(async () =>
    getRlsDb().encryptionRotation.findUnique({ where: { id: rotationId } })
  );
  if (existing?.currentTable) {
    const idx = REENCRYPT_TABLE_PLAN.findIndex((t) => t.table === existing.currentTable);
    if (idx >= 0) tableIndex = idx;
    cursorId = existing.cursorId || '';
  }

  try {
    while (tableIndex < REENCRYPT_TABLE_PLAN.length) {
      const plan = REENCRYPT_TABLE_PLAN[tableIndex]!;
      const cancelled = await withRlsBypass(async () => {
        const r = await getRlsDb().encryptionRotation.findUnique({
          where: { id: rotationId },
          select: { cancelRequested: true, status: true },
        });
        return r?.cancelRequested || r?.status === 'cancelled';
      });
      if (cancelled) {
        await withRlsBypass(async () => {
          await getRlsDb().encryptionRotation.update({
            where: { id: rotationId },
            data: {
              status: 'cancelled',
              finishedAt: new Date(),
            },
          });
        });
        logger.info('encryption.rotation_cancelled', { rotationId });
        return;
      }

      const batch = await processTableBatch(plan.table, plan.columns, cursorId, BATCH_SIZE);
      cursorId = batch.nextCursor;
      await withRlsBypass(async () => {
        await getRlsDb().encryptionRotation.update({
          where: { id: rotationId },
          data: {
            currentTable: plan.table,
            cursorId: batch.nextCursor,
            processedRecords: { increment: batch.scanned },
            updatedRecords: { increment: batch.updated },
            failedRecords: { increment: batch.failed },
            updatedAt: new Date(),
          },
        });
      });

      if (batch.done) {
        tableIndex += 1;
        cursorId = '';
      }
    }

    await withRlsBypass(async () => {
      await getRlsDb().encryptionRotation.update({
        where: { id: rotationId },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          currentTable: '',
          cursorId: '',
        },
      });
    });
    logger.info('encryption.rotation_completed', { rotationId });
    try {
      await writeAuditedAccess({
        action: 'encryption.rotation_complete',
        dealershipId: 'platform',
        technicianId: existing?.startedByTechnicianId || 'system',
        entityType: 'encryptionRotation',
        entityId: rotationId,
        metadata: { status: 'completed' },
      });
    } catch {
      // best-effort
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withRlsBypass(async () => {
      await getRlsDb().encryptionRotation.update({
        where: { id: rotationId },
        data: {
          status: 'failed',
          errorMessage: message.slice(0, 500),
          finishedAt: new Date(),
        },
      });
    });
    logger.error('encryption.rotation_failed', { rotationId, error: message });
  }
}

async function processTableBatch(
  table: string,
  columns: string[],
  cursorId: string,
  take: number
): Promise<{ scanned: number; updated: number; failed: number; nextCursor: string; done: boolean }> {
  return withRlsBypass(async () => {
    const db = getRlsDb() as unknown as Record<
      string,
      {
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
        update: (args: unknown) => Promise<unknown>;
      }
    >;
    const model = db[table];
    if (!model?.findMany) {
      return { scanned: 0, updated: 0, failed: 0, nextCursor: '', done: true };
    }

    const select: Record<string, boolean> = { id: true };
    for (const c of columns) select[c] = true;

    const rows = await model.findMany({
      take,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      orderBy: { id: 'asc' },
      select,
    });

    if (rows.length === 0) {
      return { scanned: 0, updated: 0, failed: 0, nextCursor: cursorId, done: true };
    }

    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      const data: Record<string, string> = {};
      for (const col of columns) {
        const val = row[col];
        if (typeof val !== 'string' || !val) continue;
        try {
          const next = reencryptCiphertextWithCurrentKey(val);
          if (next && next !== val) {
            data[col] = next;
          }
        } catch {
          failed += 1;
        }
      }
      if (Object.keys(data).length > 0) {
        try {
          await model.update({ where: { id: row.id }, data });
          updated += 1;
        } catch {
          failed += 1;
        }
      }
    }

    const nextCursor = String(rows[rows.length - 1]?.id || cursorId);
    return {
      scanned: rows.length,
      updated,
      failed,
      nextCursor,
      done: rows.length < take,
    };
  });
}
