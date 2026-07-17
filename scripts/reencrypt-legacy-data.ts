/**
 * Re-encrypt legacy plaintext database values after column renames.
 * Safe to run multiple times — already-encrypted rows are skipped.
 *
 * Usage: npm run db:reencrypt
 * S2 dual-storage backfill (roNumber, description, displayName): npm run db:migrate-pii
 *
 * Requires: DATABASE_URL and DATA_ENCRYPTION_KEY in the environment.
 *
 * L4 — Key rotation operations (Phase 1 accepted risk)
 * ─────────────────────────────────────────────────────
 * This script is the ONLY supported path for re-encrypting PII after DATA_ENCRYPTION_KEY
 * or SEARCH_HMAC_KEY rotation. Phase 1 does not support hot key rollover — run during
 * a maintenance window with MERLIN_MAINTENANCE_MODE=true. Full checklist: docs/Reencryption-Runbook.md
 */
import { PrismaClient } from '@prisma/client';
import {
  migrateRepairLinesS2,
  migrateRepairOrdersS2,
  migrateServiceAdvisorsS2,
} from './migrate-pii-to-encrypted';
import {
  migratePlaintextComplaintsToEncrypted,
  migratePlaintextJsonObjectToEncrypted,
  migratePlaintextOptionalToEncrypted,
  migratePlaintextStringArrayToEncrypted,
  migratePlaintextToEncrypted,
} from '../src/lib/encryption';

const prisma = new PrismaClient();

/** M26: batch size keeps memory flat on large production databases. */
const BATCH_SIZE = Math.max(10, Number(process.env.REENCRYPT_BATCH_SIZE ?? 100));

interface MigrationStats {
  scanned: number;
  updated: number;
}

async function migrateRepairOrders(): Promise<MigrationStats> {
  let scanned = 0;
  let updated = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.repairOrder.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        vinEncrypted: true,
        customerNameEncrypted: true,
        complaintsEncrypted: true,
        xentryOcrTextsEncrypted: true,
        serviceAdvisorNameEncrypted: true,
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]?.id;

    for (const row of rows) {
      scanned += 1;
      const data: Record<string, string> = {};

      const vin = migratePlaintextToEncrypted(row.vinEncrypted);
      if (vin !== row.vinEncrypted) data.vinEncrypted = vin;

      const customerName = migratePlaintextToEncrypted(row.customerNameEncrypted);
      if (customerName !== row.customerNameEncrypted) data.customerNameEncrypted = customerName;

      const complaints = migratePlaintextComplaintsToEncrypted(row.complaintsEncrypted);
      if (complaints !== row.complaintsEncrypted) data.complaintsEncrypted = complaints;

      const ocrTexts = migratePlaintextStringArrayToEncrypted(row.xentryOcrTextsEncrypted);
      if (ocrTexts !== row.xentryOcrTextsEncrypted) data.xentryOcrTextsEncrypted = ocrTexts;

      const advisorName = migratePlaintextToEncrypted(row.serviceAdvisorNameEncrypted);
      if (advisorName !== row.serviceAdvisorNameEncrypted) data.serviceAdvisorNameEncrypted = advisorName;

      if (Object.keys(data).length > 0) {
        await prisma.repairOrder.update({ where: { id: row.id }, data });
        updated += 1;
      }
    }
    if (rows.length < BATCH_SIZE) break;
  }

  return { scanned, updated };
}

async function migrateRepairLines(): Promise<MigrationStats> {
  let scanned = 0;
  let updated = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.repairLine.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        customerConcernEncrypted: true,
        technicianNotesEncrypted: true,
        xentryOcrTextsEncrypted: true,
        extractedDataEncrypted: true,
        warrantyStoryEncrypted: true,
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]?.id;

    for (const row of rows) {
      scanned += 1;
      const data: Record<string, string | null> = {};

      const customerConcern = migratePlaintextToEncrypted(row.customerConcernEncrypted);
      if (customerConcern !== row.customerConcernEncrypted) data.customerConcernEncrypted = customerConcern;

      const technicianNotes = migratePlaintextToEncrypted(row.technicianNotesEncrypted);
      if (technicianNotes !== row.technicianNotesEncrypted) data.technicianNotesEncrypted = technicianNotes;

      const ocrTexts = migratePlaintextStringArrayToEncrypted(row.xentryOcrTextsEncrypted);
      if (ocrTexts !== row.xentryOcrTextsEncrypted) data.xentryOcrTextsEncrypted = ocrTexts;

      const extractedData = migratePlaintextJsonObjectToEncrypted(row.extractedDataEncrypted);
      if (extractedData !== row.extractedDataEncrypted) data.extractedDataEncrypted = extractedData;

      const warrantyStory = migratePlaintextOptionalToEncrypted(row.warrantyStoryEncrypted);
      if (warrantyStory !== row.warrantyStoryEncrypted) data.warrantyStoryEncrypted = warrantyStory;

      if (Object.keys(data).length > 0) {
        await prisma.repairLine.update({ where: { id: row.id }, data });
        updated += 1;
      }
    }
    if (rows.length < BATCH_SIZE) break;
  }

  return { scanned, updated };
}

async function migrateAdvisorObservations(): Promise<MigrationStats> {
  const rows = await prisma.advisorComplaintObservation.findMany({
    select: { id: true, complaintTextEncrypted: true },
  });

  let updated = 0;
  for (const row of rows) {
    const complaintText = migratePlaintextToEncrypted(row.complaintTextEncrypted);
    if (complaintText === row.complaintTextEncrypted) continue;
    await prisma.advisorComplaintObservation.update({
      where: { id: row.id },
      data: { complaintTextEncrypted: complaintText },
    });
    updated += 1;
  }

  return { scanned: rows.length, updated };
}

async function migrateTemplates(): Promise<MigrationStats> {
  const rows = await prisma.template.findMany({
    select: { id: true, contentEncrypted: true },
  });

  let updated = 0;
  for (const row of rows) {
    const content = migratePlaintextToEncrypted(row.contentEncrypted);
    if (content === row.contentEncrypted) continue;
    await prisma.template.update({
      where: { id: row.id },
      data: { contentEncrypted: content },
    });
    updated += 1;
  }

  return { scanned: rows.length, updated };
}

async function migrateKnowledgeBase(): Promise<MigrationStats> {
  const rows = await prisma.knowledgeBase.findMany({
    select: {
      id: true,
      generatedTextEncrypted: true,
      fullOriginalTextEncrypted: true,
      cleanTemplateEncrypted: true,
    },
  });

  let updated = 0;
  for (const row of rows) {
    const data: Record<string, string | null> = {};

    const generatedText = migratePlaintextOptionalToEncrypted(row.generatedTextEncrypted);
    if (generatedText !== row.generatedTextEncrypted) data.generatedTextEncrypted = generatedText;

    const fullOriginalText = migratePlaintextToEncrypted(row.fullOriginalTextEncrypted);
    if (fullOriginalText !== row.fullOriginalTextEncrypted) data.fullOriginalTextEncrypted = fullOriginalText;

    const cleanTemplate = migratePlaintextToEncrypted(row.cleanTemplateEncrypted);
    if (cleanTemplate !== row.cleanTemplateEncrypted) data.cleanTemplateEncrypted = cleanTemplate;

    if (Object.keys(data).length > 0) {
      await prisma.knowledgeBase.update({ where: { id: row.id }, data });
      updated += 1;
    }
  }

  return { scanned: rows.length, updated };
}

async function main(): Promise<void> {
  if (!process.env.DATA_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY.length < 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be set (min 32 chars) before running db:reencrypt');
  }

  console.log('Re-encrypting legacy plaintext records...');

  const results = {
    s2DualStorage: {
      repairOrders: await migrateRepairOrdersS2(),
      repairLines: await migrateRepairLinesS2(),
      serviceAdvisors: await migrateServiceAdvisorsS2(),
    },
    repairOrders: await migrateRepairOrders(),
    repairLines: await migrateRepairLines(),
    advisorObservations: await migrateAdvisorObservations(),
    templates: await migrateTemplates(),
    knowledgeBase: await migrateKnowledgeBase(),
  };

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });