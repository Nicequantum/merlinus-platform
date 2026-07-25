/**
 * Server-side create-RO idempotency via AuditLog metadata.
 * No schema migration — keys live in ro.create audit rows for 24h replay.
 *
 * Uses **base** getDb() for AuditLog lookups (same D1 reliability constraint as
 * appendAuditLogInTransaction — RLS-extended auditLog.findMany fails live).
 */

import 'server-only';

import type { Prisma } from '@prisma/client';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
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
 * `tx` is used only for reloading the RO under the ambient RLS client.
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
  const sinceIso = since.toISOString();
  const needle = `"idempotencyKey":"${key}"`;

  let entityIds: string[] = [];

  try {
    const base = await getDb();
    // Prefer raw SQL — avoids RLS-extended findMany ConnectorError on D1.
    const rows = await base.$queryRawUnsafe<Array<{ entityId: string | null }>>(
      `SELECT "entityId" AS entityId FROM "AuditLog"
       WHERE "action" = 'ro.create'
         AND "dealershipId" = ?
         AND "technicianId" = ?
         AND "createdAt" >= ?
         AND "metadata" LIKE ?
       ORDER BY "createdAt" DESC
       LIMIT 8`,
      input.dealershipId,
      input.technicianId,
      sinceIso,
      `%${needle}%`
    );
    entityIds = rows.map((r) => r.entityId).filter((id): id is string => Boolean(id));
  } catch (rawError) {
    try {
      const base = await getDb();
      const rows = await base.auditLog.findMany({
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
          if (meta.idempotencyKey === key) entityIds.push(row.entityId);
        } catch {
          // skip
        }
      }
    } catch (findError) {
      logger.warn('ros.create.idempotency_lookup_failed', {
        dealershipId: input.dealershipId,
        error:
          findError instanceof Error
            ? findError.message
            : rawError instanceof Error
              ? rawError.message
              : 'unknown',
      });
      return null;
    }
  }

  for (const entityId of entityIds) {
    const ro = await tx.repairOrder.findFirst({
      where: {
        id: entityId,
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
