/**
 * First-story billing meter for warranty AI generation.
 *
 * Exactly one usage_events row with event_type=story_generated per repair line,
 * recorded in the same transaction as the first successful generate-story persist.
 * Regenerations are no-ops (story_generated already true / unique constraint).
 */

import 'server-only';

import type { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

export const STORY_GENERATED_EVENT_TYPE = 'story_generated' as const;

export type RecordFirstStoryGeneratedInput = {
  dealershipId: string;
  /** Optional Apex dealer portfolio id — never trust client; session-derived only. */
  dealerId?: string | null;
  repairOrderId: string;
  repairLineId: string;
  /**
   * Scoped where for the line (must include dealership via repairOrder).
   * Prevents cross-tenant billing writes.
   */
  lineWhere: Prisma.RepairLineWhereInput;
};

export type RecordFirstStoryGeneratedResult = {
  /** True when a new usage_events row was inserted. */
  recorded: boolean;
};

/**
 * Atomically mark first story generated and insert one usage_events row.
 * Safe under concurrent regenerates: updateMany WHERE story_generated=false + unique(line,event).
 *
 * Call only after a non-empty AI story has been written in the same transaction.
 * Failures throw so the parent generate transaction rolls back (no story without consistent billing).
 */
export async function recordFirstStoryGeneratedUsage(
  tx: Prisma.TransactionClient,
  input: RecordFirstStoryGeneratedInput
): Promise<RecordFirstStoryGeneratedResult> {
  const dealershipId = input.dealershipId?.trim();
  const repairOrderId = input.repairOrderId?.trim();
  const repairLineId = input.repairLineId?.trim();
  if (!dealershipId || !repairOrderId || !repairLineId) {
    throw new Error('story usage billing requires dealershipId, repairOrderId, and repairLineId');
  }

  // Conditional flip: only the first successful writer wins.
  const flipped = await tx.repairLine.updateMany({
    where: {
      AND: [input.lineWhere, { storyGenerated: false }],
    },
    data: { storyGenerated: true },
  });

  if (flipped.count === 0) {
    // Already billed (or line not found — parent persist already required count>0).
    return { recorded: false };
  }

  try {
    await tx.usageEvent.create({
      data: {
        dealershipId,
        dealerId: input.dealerId?.trim() || null,
        repairOrderId,
        repairLineId,
        eventType: STORY_GENERATED_EVENT_TYPE,
      },
    });
  } catch (error) {
    // Unique (line_id, event_type) race: treat as already recorded, leave storyGenerated=true.
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code)
        : '';
    if (code === 'P2002') {
      logger.info('story.usage.billing_duplicate_suppressed', {
        repairLineId,
        repairOrderId,
        dealershipId,
      });
      return { recorded: false };
    }
    throw error;
  }

  logger.info('story.usage.billing_first_story', {
    repairLineId,
    repairOrderId,
    dealershipId,
  });
  return { recorded: true };
}
