import 'server-only';

import type { Prisma } from '@prisma/client';
import { decryptJsonObject } from '@/lib/encryption';
import { hashWarrantyStory } from '@/lib/storyHash';
import { isStoryQualityCurrent } from '@/lib/storyQualityState';
import { getRlsDb, type RlsDbClient } from '@/lib/apex/rlsContext';
import type { StoryQualityResult } from '@/types';

/** Durable audit actions that prove an MI score was run for a specific story version. */
export const STORY_MI_SCORE_AUDIT_ACTIONS = ['story.score', 'story.review'] as const;

export type StoryMiScoreAuditAction = (typeof STORY_MI_SCORE_AUDIT_ACTIONS)[number];

export type StoryCertificationGateFailureReason =
  | 'missing_generate_audit'
  | 'missing_quality_audit'
  | 'parse_failed'
  | 'stale_quality_audit'
  | 'missing_score_audit_log'
  | 'story_hash_mismatch';

export interface StoryCertificationGateResult {
  ok: boolean;
  reason?: StoryCertificationGateFailureReason;
  message: string;
  storyHash?: string;
  quality?: StoryQualityResult;
}

/** Thrown inside certification transactions when prerequisites fail under row lock. */
export class StoryCertificationGateError extends Error {
  readonly result: StoryCertificationGateResult;

  constructor(result: StoryCertificationGateResult) {
    super(result.message);
    this.name = 'StoryCertificationGateError';
    this.result = result;
  }
}

export function parseStoredStoryQualityAudit(
  encrypted: string | null | undefined
): StoryQualityResult | null {
  if (!encrypted?.trim()) return null;
  const parsed = decryptJsonObject<StoryQualityResult | null>(encrypted, null);
  if (!parsed || typeof parsed.score !== 'number') return null;
  return parsed;
}

export function parseAuditLogMetadata(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** True when audit metadata binds to the same CDK-normalized story hash as certification. */
export function auditMetadataMatchesStoryHash(
  metadataRaw: string,
  storyHash: string
): boolean {
  const meta = parseAuditLogMetadata(metadataRaw);
  const metaHash = meta.storyHash;
  return typeof metaHash === 'string' && metaHash.trim() === storyHash;
}

async function findMatchingMiScoreAuditLog(
  client: RlsDbClient,
  dealershipId: string,
  repairLineId: string,
  storyHash: string
): Promise<boolean> {
  const logs = await client.auditLog.findMany({
    where: {
      dealershipId,
      entityType: 'repairLine',
      entityId: repairLineId,
      action: { in: [...STORY_MI_SCORE_AUDIT_ACTIONS] },
      entryHash: { not: '' },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { metadata: true },
  });

  return logs.some((log: { metadata: string }) =>
    auditMetadataMatchesStoryHash(log.metadata, storyHash)
  );
}

function evaluateStoryCertificationPrerequisites(input: {
  dealershipId: string;
  repairLineId: string;
  warrantyStory: string;
  storyQualityAuditEncrypted: string | null | undefined;
  hasGenerateAudit: boolean;
  hasScoreAuditLog: boolean;
}): StoryCertificationGateResult {
  const storyHash = hashWarrantyStory(input.warrantyStory);

  if (!input.warrantyStory.trim()) {
    return {
      ok: false,
      reason: 'story_hash_mismatch',
      message: 'Warranty story text is required for certification.',
      storyHash,
    };
  }

  if (!input.hasGenerateAudit) {
    return {
      ok: false,
      reason: 'missing_generate_audit',
      message: 'Only AI-generated warranty stories require technician certification.',
      storyHash,
    };
  }

  const quality = parseStoredStoryQualityAudit(input.storyQualityAuditEncrypted);
  if (!quality) {
    return {
      ok: false,
      reason: 'missing_quality_audit',
      message: 'Run Audit Story on the current warranty narrative before certifying.',
      storyHash,
    };
  }

  if (quality.parseFailed) {
    return {
      ok: false,
      reason: 'parse_failed',
      message: 'The last MI audit could not be read. Tap Audit Story again before certifying.',
      storyHash,
      quality,
    };
  }

  if (!isStoryQualityCurrent(quality, input.warrantyStory)) {
    return {
      ok: false,
      reason: 'stale_quality_audit',
      message:
        'The warranty story changed after the last audit. Tap Audit Story again, then complete certification.',
      storyHash,
      quality,
    };
  }

  if (!input.hasScoreAuditLog) {
    return {
      ok: false,
      reason: 'missing_score_audit_log',
      message: 'No MI audit record found for this story version. Tap Audit Story before certifying.',
      storyHash,
      quality,
    };
  }

  const qualityStoryHash = hashWarrantyStory(quality.scoredAgainstStory ?? input.warrantyStory);
  if (qualityStoryHash !== storyHash) {
    return {
      ok: false,
      reason: 'story_hash_mismatch',
      message: 'MI audit does not match the story being certified. Tap Audit Story again.',
      storyHash,
      quality,
    };
  }

  return {
    ok: true,
    message: 'Certification prerequisites satisfied.',
    storyHash,
    quality,
  };
}

/**
 * Lock the repair line row for certification — must run at the start of the certify transaction.
 * SELECT FOR UPDATE prevents concurrent story/audit edits between gate check and certify write.
 */
export async function lockRepairLineForCertification(
  tx: Prisma.TransactionClient,
  input: { repairLineId: string; dealershipId: string }
): Promise<{ id: string; storyQualityAuditEncrypted: string } | null> {
  // SQLite/D1 has no FOR UPDATE row locks — still scope by dealership for isolation.
  const rows = await tx.$queryRaw<Array<{ id: string; storyQualityAuditEncrypted: string }>>`
    SELECT rl.id, rl."storyQualityAuditEncrypted"
    FROM "RepairLine" rl
    INNER JOIN "RepairOrder" ro ON ro.id = rl."repairOrderId"
    WHERE rl.id = ${input.repairLineId}
      AND ro."dealershipId" = ${input.dealershipId}
  `;
  return rows[0] ?? null;
}

/**
 * Certification prerequisites evaluated inside an open transaction on a locked repair line.
 * Eliminates TOCTOU between gate check and certify persist.
 */
export async function validateStoryCertificationPrerequisitesInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    dealershipId: string;
    repairLineId: string;
    warrantyStory: string;
    lockedLine: { storyQualityAuditEncrypted: string };
  }
): Promise<StoryCertificationGateResult> {
  const hasGenerateAudit = await tx.auditLog.findFirst({
    where: {
      dealershipId: input.dealershipId,
      entityType: 'repairLine',
      entityId: input.repairLineId,
      action: 'story.generate',
      entryHash: { not: '' },
    },
    select: { id: true },
  });

  const storyHash = hashWarrantyStory(input.warrantyStory);
  const hasScoreAuditLog = await findMatchingMiScoreAuditLog(
    tx,
    input.dealershipId,
    input.repairLineId,
    storyHash
  );

  return evaluateStoryCertificationPrerequisites({
    dealershipId: input.dealershipId,
    repairLineId: input.repairLineId,
    warrantyStory: input.warrantyStory,
    storyQualityAuditEncrypted: input.lockedLine.storyQualityAuditEncrypted,
    hasGenerateAudit: Boolean(hasGenerateAudit),
    hasScoreAuditLog,
  });
}

/**
 * Server-side certification prerequisites — non-bypassable compliance gate.
 * Requires a current persisted MI quality audit and a matching durable score/review audit log.
 *
 * @deprecated Prefer validateStoryCertificationPrerequisitesInTransaction inside certify txn.
 */
export async function validateStoryCertificationPrerequisites(input: {
  dealershipId: string;
  repairLineId: string;
  /** CDK-sanitized warranty story text submitted for certification. */
  warrantyStory: string;
}): Promise<StoryCertificationGateResult> {
  const storyHash = hashWarrantyStory(input.warrantyStory);

  const hasGenerateAudit = await getRlsDb().auditLog.findFirst({
    where: {
      dealershipId: input.dealershipId,
      entityType: 'repairLine',
      entityId: input.repairLineId,
      action: 'story.generate',
      entryHash: { not: '' },
    },
    select: { id: true },
  });

  const dbLine = await getRlsDb().repairLine.findFirst({
    where: {
      id: input.repairLineId,
      repairOrder: { dealershipId: input.dealershipId },
    },
    select: { storyQualityAuditEncrypted: true },
  });

  const hasScoreAuditLog = await findMatchingMiScoreAuditLog(
    getRlsDb(),
    input.dealershipId,
    input.repairLineId,
    storyHash
  );

  return evaluateStoryCertificationPrerequisites({
    dealershipId: input.dealershipId,
    repairLineId: input.repairLineId,
    warrantyStory: input.warrantyStory,
    storyQualityAuditEncrypted: dbLine?.storyQualityAuditEncrypted,
    hasGenerateAudit: Boolean(hasGenerateAudit),
    hasScoreAuditLog,
  });
}