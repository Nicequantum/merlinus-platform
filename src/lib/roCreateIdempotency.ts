/**
 * Server-side create-RO idempotency via AuditLog metadata.
 * No schema migration — keys live in ro.create audit rows for 24h replay.
 */

import 'server-only';

import type { Prisma } from '@prisma/client';
import { dbToRepairOrder } from '@/lib/roMapper';
import type { RepairOrder } from '@/types';
import {
  idempotencyMetadata,
  normalizeIdempotencyKey,
  readIdempotencyKeyFromRequest,
} from '@/lib/roCreateIdempotency.shared';

export {
  idempotencyMetadata,
  normalizeIdempotencyKey,
  readIdempotencyKeyFromRequest,
} from '@/lib/roCreateIdempotency.shared';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Find a prior successful create for this technician+dealership+key within TTL.
 */
export async function findIdempotentRepairOrderCreate(
  tx: Prisma.TransactionClient,
  input: {
    dealershipId: string;
    technicianId: string;
    idempotencyKey: string;
  }
): Promise<RepairOrder | null> {
  const key = normalizeIdempotencyKey(input.idempotencyKey);
  if (!key) return null;

  const since = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
  // String contains match on JSON metadata — keys are restricted charset so safe.
  const needle = `"idempotencyKey":"${key}"`;
  const rows = await tx.auditLog.findMany({
    where: {
      action: 'ro.create',
      dealershipId: input.dealershipId,
      technicianId: input.technicianId,
      createdAt: { gte: since },
      metadata: { contains: needle },
    },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { entityId: true, metadata: true },
  });

  for (const row of rows) {
    if (!row.entityId) continue;
    try {
      const meta = JSON.parse(row.metadata || '{}') as { idempotencyKey?: string };
      if (meta.idempotencyKey !== key) continue;
    } catch {
      continue;
    }
    const ro = await tx.repairOrder.findFirst({
      where: {
        id: row.entityId,
        dealershipId: input.dealershipId,
        technicianId: input.technicianId,
      },
      include: {
        repairLines: true,
        serviceAdvisor: { select: { id: true, displayNameEncrypted: true } },
      },
    });
    if (ro) return dbToRepairOrder(ro);
  }
  return null;
}
