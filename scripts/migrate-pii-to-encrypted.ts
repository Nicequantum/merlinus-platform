/**
 * S2 / Phase 5 — Maintain encrypted PII columns and search tokens.
 *
 * Post-Phase-5: plaintext twin columns (roNumber, description, displayName) are dropped.
 * This script re-encrypts legacy plaintext-in-encrypted-column rows and backfills
 * roNumberSearchTokens where missing. Idempotent — safe to re-run until pending = 0.
 *
 * ROLLBACK: restore pre-migration database backup.
 *
 * Usage:
 *   npm run db:migrate-pii-safe
 *   npm run db:migrate-pii
 *
 * Requires: DATABASE_URL and DATA_ENCRYPTION_KEY (min 32 chars).
 */
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import { isLikelyEncryptedPayload, migratePlaintextToEncrypted } from '../src/lib/encryption';
import { readRoNumberFromDb } from '../src/lib/piiFieldRead';
import { buildRoNumberSearchTokens } from '../src/lib/piiSearchToken';

const prisma = new PrismaClient();

const BATCH_SIZE = Math.max(10, Number(process.env.REENCRYPT_BATCH_SIZE ?? 100));
const DRY_RUN =
  process.argv.includes('--dry-run') ||
  ['1', 'true', 'yes'].includes((process.env.DRY_RUN ?? '').toLowerCase());

export interface MigrationStats {
  scanned: number;
  updated: number;
  skipped: number;
}

export interface S2MigrationResults {
  dryRun: boolean;
  batchSize: number;
  pendingBeforeRun: {
    repairOrders: number;
    repairLines: number;
    serviceAdvisors: number;
  };
  repairOrders: MigrationStats;
  repairLines: MigrationStats;
  serviceAdvisors: MigrationStats;
  pendingAfterRun: {
    repairOrders: number;
    repairLines: number;
    serviceAdvisors: number;
  };
}

function needsEncryptedBackfill(encrypted: string): boolean {
  if (!encrypted?.trim()) return true;
  return !isLikelyEncryptedPayload(encrypted);
}

function resolveEncryptedColumn(encrypted: string): string | null {
  if (!encrypted?.trim()) return null;
  const next = migratePlaintextToEncrypted(encrypted);
  if (!next || next === encrypted) return null;
  return next;
}

function logBatch(table: string, batch: number, stats: MigrationStats): void {
  console.log(
    `[migrate-pii] ${table} batch ${batch}: scanned=${stats.scanned} updated=${stats.updated} skipped=${stats.skipped}${
      DRY_RUN ? ' (dry-run)' : ''
    }`
  );
}

export async function migrateRepairOrdersS2(): Promise<MigrationStats> {
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let cursor: string | undefined;
  let batch = 0;

  for (;;) {
    const rows = await prisma.repairOrder.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        roNumberEncrypted: true,
        roNumberSearchTokens: true,
        serviceAdvisorNameEncrypted: true,
      },
    });
    if (rows.length === 0) break;
    batch += 1;
    cursor = rows[rows.length - 1]?.id;

    let batchUpdated = 0;
    let batchSkipped = 0;

    for (const row of rows) {
      scanned += 1;
      const data: Record<string, string | string[]> = {};

      const roNumberEnc = resolveEncryptedColumn(row.roNumberEncrypted);
      if (roNumberEnc) data.roNumberEncrypted = roNumberEnc;

      const roNumberValue = readRoNumberFromDb({
        roNumberEncrypted: (data.roNumberEncrypted as string | undefined) ?? row.roNumberEncrypted,
      });
      if (roNumberValue) {
        const tokens = buildRoNumberSearchTokens(roNumberValue);
        const existingTokens = row.roNumberSearchTokens ?? [];
        if (tokens.length > 0) {
          const sortedNew = [...tokens].sort().join('|');
          const sortedOld = [...existingTokens].sort().join('|');
          if (sortedNew !== sortedOld) {
            data.roNumberSearchTokens = tokens;
          }
        }
      }

      if (row.serviceAdvisorNameEncrypted?.trim()) {
        const advisorEnc = migratePlaintextToEncrypted(row.serviceAdvisorNameEncrypted);
        if (advisorEnc !== row.serviceAdvisorNameEncrypted) {
          data.serviceAdvisorNameEncrypted = advisorEnc;
        }
      }

      if (Object.keys(data).length === 0) {
        skipped += 1;
        batchSkipped += 1;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.repairOrder.update({ where: { id: row.id }, data });
      }
      updated += 1;
      batchUpdated += 1;
    }

    logBatch('repairOrder', batch, {
      scanned: rows.length,
      updated: batchUpdated,
      skipped: batchSkipped,
    });

    if (rows.length < BATCH_SIZE) break;
  }

  return { scanned, updated, skipped };
}

export async function migrateRepairLinesS2(): Promise<MigrationStats> {
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let cursor: string | undefined;
  let batch = 0;

  for (;;) {
    const rows = await prisma.repairLine.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        descriptionEncrypted: true,
      },
    });
    if (rows.length === 0) break;
    batch += 1;
    cursor = rows[rows.length - 1]?.id;

    let batchUpdated = 0;
    let batchSkipped = 0;

    for (const row of rows) {
      scanned += 1;
      const descriptionEnc = resolveEncryptedColumn(row.descriptionEncrypted);
      if (!descriptionEnc) {
        skipped += 1;
        batchSkipped += 1;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.repairLine.update({
          where: { id: row.id },
          data: { descriptionEncrypted: descriptionEnc },
        });
      }
      updated += 1;
      batchUpdated += 1;
    }

    logBatch('repairLine', batch, {
      scanned: rows.length,
      updated: batchUpdated,
      skipped: batchSkipped,
    });

    if (rows.length < BATCH_SIZE) break;
  }

  return { scanned, updated, skipped };
}

export async function migrateServiceAdvisorsS2(): Promise<MigrationStats> {
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let cursor: string | undefined;
  let batch = 0;

  for (;;) {
    const rows = await prisma.serviceAdvisor.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        displayNameEncrypted: true,
      },
    });
    if (rows.length === 0) break;
    batch += 1;
    cursor = rows[rows.length - 1]?.id;

    let batchUpdated = 0;
    let batchSkipped = 0;

    for (const row of rows) {
      scanned += 1;
      const displayNameEnc = resolveEncryptedColumn(row.displayNameEncrypted);
      if (!displayNameEnc) {
        skipped += 1;
        batchSkipped += 1;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.serviceAdvisor.update({
          where: { id: row.id },
          data: { displayNameEncrypted: displayNameEnc },
        });
      }
      updated += 1;
      batchUpdated += 1;
    }

    logBatch('serviceAdvisor', batch, {
      scanned: rows.length,
      updated: batchUpdated,
      skipped: batchSkipped,
    });

    if (rows.length < BATCH_SIZE) break;
  }

  return { scanned, updated, skipped };
}

async function countPendingS2Rows(): Promise<S2MigrationResults['pendingAfterRun']> {
  const pending = { repairOrders: 0, repairLines: 0, serviceAdvisors: 0 };

  let roCursor: string | undefined;
  for (;;) {
    const rows = await prisma.repairOrder.findMany({
      take: BATCH_SIZE,
      ...(roCursor ? { skip: 1, cursor: { id: roCursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, roNumberEncrypted: true },
    });
    if (rows.length === 0) break;
    roCursor = rows[rows.length - 1]?.id;
    for (const row of rows) {
      if (needsEncryptedBackfill(row.roNumberEncrypted)) pending.repairOrders += 1;
    }
    if (rows.length < BATCH_SIZE) break;
  }

  let lineCursor: string | undefined;
  for (;;) {
    const rows = await prisma.repairLine.findMany({
      take: BATCH_SIZE,
      ...(lineCursor ? { skip: 1, cursor: { id: lineCursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, descriptionEncrypted: true },
    });
    if (rows.length === 0) break;
    lineCursor = rows[rows.length - 1]?.id;
    for (const row of rows) {
      if (needsEncryptedBackfill(row.descriptionEncrypted)) pending.repairLines += 1;
    }
    if (rows.length < BATCH_SIZE) break;
  }

  let advisorCursor: string | undefined;
  for (;;) {
    const rows = await prisma.serviceAdvisor.findMany({
      take: BATCH_SIZE,
      ...(advisorCursor ? { skip: 1, cursor: { id: advisorCursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, displayNameEncrypted: true },
    });
    if (rows.length === 0) break;
    advisorCursor = rows[rows.length - 1]?.id;
    for (const row of rows) {
      if (needsEncryptedBackfill(row.displayNameEncrypted)) pending.serviceAdvisors += 1;
    }
    if (rows.length < BATCH_SIZE) break;
  }

  return pending;
}

export async function runS2PiiMigration(): Promise<S2MigrationResults> {
  const pendingBeforeRun = await countPendingS2Rows();

  const repairOrders = await migrateRepairOrdersS2();
  const repairLines = await migrateRepairLinesS2();
  const serviceAdvisors = await migrateServiceAdvisorsS2();

  const pendingAfterRun = DRY_RUN ? pendingBeforeRun : await countPendingS2Rows();

  return {
    dryRun: DRY_RUN,
    batchSize: BATCH_SIZE,
    pendingBeforeRun,
    repairOrders,
    repairLines,
    serviceAdvisors,
    pendingAfterRun,
  };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL must be set before running db:migrate-pii');
  }
  if (!process.env.DATA_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY.length < 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be set (min 32 chars) before running db:migrate-pii');
  }

  console.log(
    DRY_RUN
      ? '[migrate-pii] DRY RUN — no database writes; reporting rows that WOULD be updated'
      : '[migrate-pii] EXECUTE — maintaining encrypted PII columns and search tokens (batched)'
  );
  console.log(`[migrate-pii] batch size: ${BATCH_SIZE}`);
  if (!DRY_RUN) {
    console.log('[migrate-pii] Rollback: restore pre-migration database backup if needed.');
  }

  const results = await runS2PiiMigration();
  console.log(JSON.stringify({ ok: true, ...results }, null, 2));

  const totalWouldUpdate =
    results.repairOrders.updated + results.repairLines.updated + results.serviceAdvisors.updated;

  if (DRY_RUN) {
    console.log(
      `[migrate-pii] Dry-run complete — ${totalWouldUpdate} row(s) would be updated across all tables.`
    );
    if (Object.values(results.pendingBeforeRun).some((n) => n > 0)) {
      console.log(
        '[migrate-pii] Run npm run db:migrate-pii to execute after reviewing counts above.'
      );
    } else {
      console.log('[migrate-pii] No pending encrypted backfill rows — database is up to date.');
    }
    return;
  }

  if (Object.values(results.pendingAfterRun).some((n) => n > 0)) {
    console.warn(
      '[migrate-pii] Some rows still need backfill — re-run npm run db:migrate-pii until pendingAfterRun is 0.'
    );
  } else {
    console.log('[migrate-pii] Encrypted PII maintenance complete — all pending counts are 0.');
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}