import 'server-only';

import type { Prisma } from '@prisma/client';
import { appendAuditLogInTransaction, type AuditLogInput } from './audit';

/**
 * Atomically append a hash-chained audit entry and update the repair line.
 * If either step fails, the entire transaction rolls back — no orphan audits or partial persists.
 */
export async function persistRepairLineStoryInTransaction(
  tx: Prisma.TransactionClient,
  auditInput: AuditLogInput,
  update: {
    where: Prisma.RepairLineWhereInput;
    data: Prisma.RepairLineUpdateManyMutationInput;
  }
): Promise<string> {
  const auditLogId = await appendAuditLogInTransaction(tx, auditInput);
  const lineUpdated = await tx.repairLine.updateMany({
    where: update.where,
    data: update.data,
  });
  if (lineUpdated.count === 0) {
    throw new Error('Repair line not found for story persist');
  }
  return auditLogId;
}