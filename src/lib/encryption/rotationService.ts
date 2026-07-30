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
  warmEncryptionKeyring,
} from '@/lib/encryption';
import {
  finalizeInAppDekRotation,
  rotateInAppDek,
  ensureEncryptionKeyringLoaded,
} from '@/lib/encryption/keyring';
import {
  REENCRYPT_TABLE_PLAN,
  getReencryptCoverageSummary,
  MFA_REENCRYPT_TABLES,
} from '@/lib/encryption/reencryptPlan';
import { logger } from '@/lib/logger';
import { scheduleBackgroundWork } from '@/lib/aiJobs/schedule';

export type { ReencryptTablePlanEntry } from '@/lib/encryption/reencryptPlan';
export {
  REENCRYPT_TABLE_PLAN,
  getReencryptCoverageSummary,
  MFA_REENCRYPT_TABLES,
} from '@/lib/encryption/reencryptPlan';

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
  coverage: ReturnType<typeof getReencryptCoverageSummary>;
  mfaStaleProbe: Awaited<ReturnType<typeof probeStaleMfaCiphertext>> | null;
  /** 90-day key rotation cadence guidance */
  cadence: RotationCadence;
  hmacKeyConfigured: boolean;
  /** True when managers can rotate without Worker secrets */
  inAppRotationReady: boolean;
}> {
  // Self-heal missing EncryptionKeyring (D1 migration lag) then warm DEK cache.
  try {
    const { ensureEncryptionKeyringTable } = await import('@/lib/encryption/keyring');
    await ensureEncryptionKeyringTable();
  } catch {
    // fall through — warm still bootstraps from env
  }
  await warmEncryptionKeyring();
  const keys = getEncryptionKeyStatus();
  const rotation = await getActiveOrLatestRotation();
  const canStartReencrypt =
    keys.dualKeyActive &&
    (!rotation ||
      rotation.status === 'pending_env' ||
      rotation.status === 'cancelled' ||
      rotation.status === 'failed' ||
      rotation.status === 'completed');

  const coverage = getReencryptCoverageSummary();

  let mfaStaleProbe: Awaited<ReturnType<typeof probeStaleMfaCiphertext>> | null = null;
  if (keys.dualKeyActive || rotation?.status === 'completed' || rotation?.status === 'running') {
    try {
      mfaStaleProbe = await probeStaleMfaCiphertext(30);
    } catch {
      mfaStaleProbe = null;
    }
  }

  const cadence = await getRotationCadence();
  const hmacKeyConfigured = Boolean(process.env.SEARCH_HMAC_KEY?.trim());

  const instructions = [
    '1. Click “Rotate keys now” — generates a new data key inside the app (no Worker env edits).',
    '2. Background re-encryption starts automatically under dual-key decrypt (zero downtime).',
    '3. Watch progress until 100%. MFA secrets are included.',
    '4. When complete and the MFA probe is clean, previous key is retired automatically.',
    '5. Recommended cadence: every 90 days (or sooner after suspected exposure).',
  ];

  return {
    keys,
    rotation,
    canStartReencrypt,
    instructions,
    coverage,
    mfaStaleProbe,
    cadence,
    hmacKeyConfigured,
    inAppRotationReady: true,
  };
}

/** Recommended DATA_ENCRYPTION_KEY rotation interval (days). */
export const ENCRYPTION_KEY_ROTATION_RECOMMENDED_DAYS = 90;

export type RotationCadence = {
  recommendedDays: number;
  lastCompletedAt: string | null;
  daysSinceLastCompleted: number | null;
  recommendRotate: boolean;
  neverRotated: boolean;
  dualKeyOpen: boolean;
};

/**
 * 90-day rotation hygiene from EncryptionRotation history + dual-key flag.
 */
export async function getRotationCadence(): Promise<RotationCadence> {
  await ensureEncryptionKeyringLoaded();
  const dualKeyOpen = isDualKeyRotationActive();
  const ring = getEncryptionKeyStatus();
  return withRlsBypass(async () => {
    let lastCompletedAt: string | null = ring.lastRotatedAt;
    try {
      const row = await getRlsDb().encryptionRotation.findFirst({
        where: { status: 'completed' },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true, startedAt: true },
      });
      const at = row?.finishedAt || row?.startedAt || null;
      const fromJob = at ? at.toISOString() : null;
      // Prefer the more recent of keyring vs completed job
      if (fromJob) {
        if (!lastCompletedAt || new Date(fromJob) > new Date(lastCompletedAt)) {
          lastCompletedAt = fromJob;
        }
      }
    } catch {
      // ignore
    }

    let daysSinceLastCompleted: number | null = null;
    if (lastCompletedAt) {
      daysSinceLastCompleted = Math.floor(
        (Date.now() - new Date(lastCompletedAt).getTime()) / (24 * 60 * 60 * 1000)
      );
    }
    const neverRotated = !lastCompletedAt;
    const recommendRotate =
      dualKeyOpen ||
      (daysSinceLastCompleted !== null &&
        daysSinceLastCompleted >= ENCRYPTION_KEY_ROTATION_RECOMMENDED_DAYS);

    return {
      recommendedDays: ENCRYPTION_KEY_ROTATION_RECOMMENDED_DAYS,
      lastCompletedAt,
      daysSinceLastCompleted,
      recommendRotate,
      neverRotated,
      dualKeyOpen,
    };
  });
}

/**
 * Sample MFA ciphertext for rows still decryptable only via PREVIOUS key.
 * Safe: never returns secrets; counts only. Zero-downtime dual-key model preserved.
 */
export async function probeStaleMfaCiphertext(sampleLimit = 25): Promise<{
  sampled: number;
  stillOnPreviousKey: number;
  decryptFailed: number;
  tablesChecked: string[];
}> {
  const { requiresPreviousKeyToDecrypt } = await import('@/lib/encryption');
  return withRlsBypass(async () => {
    const db = getRlsDb();
    let sampled = 0;
    let stillOnPreviousKey = 0;
    let decryptFailed = 0;
    const tablesChecked: string[] = [];

    try {
      const rows = await db.userMfa.findMany({
        take: sampleLimit,
        orderBy: { id: 'asc' },
        select: { secretEncrypted: true, backupCodesEncrypted: true },
      });
      tablesChecked.push('userMfa');
      for (const row of rows) {
        for (const val of [row.secretEncrypted, row.backupCodesEncrypted]) {
          if (typeof val !== 'string' || !val.trim()) continue;
          sampled += 1;
          try {
            if (requiresPreviousKeyToDecrypt(val)) stillOnPreviousKey += 1;
          } catch {
            decryptFailed += 1;
          }
        }
      }
    } catch {
      // table may not exist in older envs
    }

    try {
      const rows = await db.technician.findMany({
        take: sampleLimit,
        orderBy: { id: 'asc' },
        where: {
          OR: [
            { mfaSecretEncrypted: { not: null } },
            { mfaBackupCodesEncrypted: { not: null } },
          ],
        },
        select: { mfaSecretEncrypted: true, mfaBackupCodesEncrypted: true },
      });
      tablesChecked.push('technician');
      for (const row of rows) {
        for (const val of [row.mfaSecretEncrypted, row.mfaBackupCodesEncrypted]) {
          if (typeof val !== 'string' || !val.trim()) continue;
          sampled += 1;
          try {
            if (requiresPreviousKeyToDecrypt(val)) stillOnPreviousKey += 1;
          } catch {
            decryptFailed += 1;
          }
        }
      }
    } catch {
      // ignore
    }

    return { sampled, stillOnPreviousKey, decryptFailed, tablesChecked };
  });
}

/**
 * After ops deploys dual-key secrets, manager pastes the new key to prove fingerprints match live env.
 * Optionally starts re-encrypt immediately.
 */
export async function confirmEncryptionEnvKey(input: {
  technicianId: string;
  dealershipId: string;
  rotationId?: string;
  /** Pasted new key — never stored; only fingerprinted for verification */
  newKey: string;
  /** When true (default), start background re-encrypt if dual-key is live */
  startReencrypt?: boolean;
}): Promise<{
  rotation: EncryptionRotationDto;
  verified: boolean;
  fingerprints: {
    submitted: string;
    livePrimary: string;
    livePrevious: string | null;
    target: string;
  };
  message: string;
}> {
  const newKey = input.newKey.trim();
  if (newKey.length < 32) {
    throw new Error('New key must be at least 32 characters.');
  }

  const submittedFp = fingerprintSecret(newKey);
  const live = getEncryptionKeyStatus();

  const row = await withRlsBypass(async () => {
    const db = getRlsDb();
    return input.rotationId
      ? db.encryptionRotation.findUnique({ where: { id: input.rotationId } })
      : db.encryptionRotation.findFirst({ orderBy: { createdAt: 'desc' } });
  });

  if (!row) {
    throw new Error('No rotation in progress. Click Generate new key first.');
  }

  if (row.targetFingerprint && row.targetFingerprint !== submittedFp) {
    throw new Error(
      `Submitted key fingerprint (${submittedFp}) does not match rotation target (${row.targetFingerprint}). Paste the key generated for this rotation.`
    );
  }

  if (!live.dualKeyActive) {
    throw new Error(
      'Dual-key is not active yet. Deploy DATA_ENCRYPTION_KEY_PREVIOUS=<old> and DATA_ENCRYPTION_KEY=<new>, then retry Submit New Key.'
    );
  }

  if (live.primaryFingerprint !== submittedFp) {
    throw new Error(
      `Live primary fingerprint (${live.primaryFingerprint}) does not match submitted key (${submittedFp}). Ensure Worker DATA_ENCRYPTION_KEY was set to this new key and the Worker was redeployed.`
    );
  }

  try {
    await writeAuditedAccess({
      action: 'encryption.rotation_env_confirmed',
      dealershipId: input.dealershipId,
      technicianId: input.technicianId,
      entityType: 'encryptionRotation',
      entityId: row.id,
      metadata: {
        submittedFingerprint: submittedFp,
        livePrimary: live.primaryFingerprint,
        livePrevious: live.previousFingerprint,
      },
    });
  } catch {
    // best-effort
  }

  logger.info('encryption.rotation_env_confirmed', {
    rotationId: row.id,
    submittedFingerprint: submittedFp,
  });

  const start = input.startReencrypt !== false;
  if (start) {
    const rotation = await startReencryptPass({
      technicianId: input.technicianId,
      dealershipId: input.dealershipId,
      rotationId: row.id,
    });
    return {
      rotation,
      verified: true,
      fingerprints: {
        submitted: submittedFp,
        livePrimary: live.primaryFingerprint,
        livePrevious: live.previousFingerprint,
        target: row.targetFingerprint,
      },
      message: 'New key verified against live dual-key env. Background re-encryption started.',
    };
  }

  const rotation = mapDto(row);
  return {
    rotation,
    verified: true,
    fingerprints: {
      submitted: submittedFp,
      livePrimary: live.primaryFingerprint,
      livePrevious: live.previousFingerprint,
      target: row.targetFingerprint,
    },
    message: 'New key verified. Click Start re-encryption when ready.',
  };
}

/**
 * Begin guided rotation: capture fingerprints, generate new key (returned once).
 * @deprecated Prefer rotateEncryptionKeysInApp — full in-app path without env edits.
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
  // Redirect legacy "generate only" into true in-app rotate so double-click / old UI
  // still produces a working dual-key window without env edits.
  const result = await rotateEncryptionKeysInApp(input);
  return {
    rotation: result.rotation,
    newKey: '', // never expose DEK material to the browser
    previousKeyFingerprint: result.previousKeyFingerprint,
    newKeyFingerprint: result.primaryFingerprint,
  };
}

/**
 * One-click in-app DEK rotation (manager/owner):
 * 1. Generate new DEK, store wrapped in EncryptionKeyring
 * 2. Old primary becomes previous (dual-key decrypt)
 * 3. Start background re-encrypt
 * 4. On complete, previous DEK is finalized away
 *
 * No Worker secret / env changes required.
 */
export async function rotateEncryptionKeysInApp(input: {
  technicianId: string;
  dealershipId: string;
}): Promise<{
  rotation: EncryptionRotationDto;
  primaryFingerprint: string;
  previousKeyFingerprint: string;
  message: string;
}> {
  await warmEncryptionKeyring();

  const active = await getActiveOrLatestRotation();
  if (active && active.status === 'running') {
    throw new Error(
      'A re-encryption job is already running. Wait for it to finish or cancel it first.'
    );
  }

  // Serialize: if dual-key still open from a prior incomplete rotate, resume reencrypt instead
  const liveBefore = getEncryptionKeyStatus();
  if (liveBefore.dualKeyActive && liveBefore.inAppKeyring) {
    const resumed = await startReencryptPass({
      technicianId: input.technicianId,
      dealershipId: input.dealershipId,
      rotationId: active?.status === 'pending_env' || active?.status === 'failed' ? active.id : undefined,
    });
    return {
      rotation: resumed,
      primaryFingerprint: liveBefore.primaryFingerprint,
      previousKeyFingerprint: liveBefore.previousFingerprint || '',
      message:
        'Dual-key window was already open — resumed re-encryption. No new key generated.',
    };
  }

  const rotated = await rotateInAppDek();

  const row = await withRlsBypass(async () =>
    getRlsDb().encryptionRotation.create({
      data: {
        status: 'running',
        primaryFingerprint: rotated.primaryFingerprint,
        previousFingerprint: rotated.previousFingerprint,
        targetFingerprint: rotated.primaryFingerprint,
        startedByTechnicianId: input.technicianId,
        cancelRequested: false,
        totalRecords: 0,
        processedRecords: 0,
        updatedRecords: 0,
        failedRecords: 0,
        currentTable: REENCRYPT_TABLE_PLAN[0]?.table || '',
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
        mode: 'in_app_dek',
        previousFingerprint: rotated.previousFingerprint,
        targetFingerprint: rotated.primaryFingerprint,
        version: rotated.version,
      },
    });
  } catch {
    // best-effort
  }

  try {
    await writeAuditedAccess({
      action: 'encryption.rotation_reencrypt_start',
      dealershipId: input.dealershipId,
      technicianId: input.technicianId,
      entityType: 'encryptionRotation',
      entityId: row.id,
      metadata: {
        mode: 'in_app_dek',
        primaryFingerprint: rotated.primaryFingerprint,
        previousFingerprint: rotated.previousFingerprint,
      },
    });
  } catch {
    // best-effort
  }

  await scheduleBackgroundWork(`encryption.reencrypt:${row.id}`, async () => {
    await runReencryptRotationJob(row.id);
  });

  logger.info('encryption.rotation_in_app', {
    rotationId: row.id,
    primaryFingerprint: rotated.primaryFingerprint,
    previousFingerprint: rotated.previousFingerprint,
  });

  return {
    rotation: mapDto(row),
    primaryFingerprint: rotated.primaryFingerprint,
    previousKeyFingerprint: rotated.previousFingerprint,
    message:
      'New encryption key activated in-app. Re-encryption started — keep this page open to watch progress. No environment variable changes needed.',
  };
}

export async function startReencryptPass(input: {
  technicianId: string;
  dealershipId: string;
  rotationId?: string;
}): Promise<EncryptionRotationDto> {
  await warmEncryptionKeyring();
  if (!isDualKeyRotationActive()) {
    throw new Error(
      'Dual-key not active. Use “Rotate keys now” to create an in-app dual-key window, then re-encrypt runs automatically.'
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
    const db = getRlsDb() as unknown as Record<
      string,
      { count?: (args?: unknown) => Promise<number> }
    >;
    let total = 0;
    for (const plan of REENCRYPT_TABLE_PLAN) {
      try {
        const model = db[plan.table];
        if (model?.count) {
          total += await model.count();
        }
      } catch {
        /* model may be absent in partial migrations */
      }
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

    // Close in-app dual-key window only when MFA ciphertext is clean on primary.
    try {
      const probe = await probeStaleMfaCiphertext(40);
      if (probe.stillOnPreviousKey === 0) {
        await finalizeInAppDekRotation();
        logger.info('encryption.keyring_auto_finalized', { rotationId, mfaSampled: probe.sampled });
      } else {
        logger.info('encryption.keyring_finalize_deferred', {
          rotationId,
          stillOnPreviousKey: probe.stillOnPreviousKey,
        });
      }
    } catch (error) {
      logger.error('encryption.keyring_finalize_failed', {
        rotationId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }

    try {
      await writeAuditedAccess({
        action: 'encryption.rotation_complete',
        dealershipId: 'platform',
        technicianId: existing?.startedByTechnicianId || 'system',
        entityType: 'encryptionRotation',
        entityId: rotationId,
        metadata: { status: 'completed', mode: 'in_app_dek' },
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
