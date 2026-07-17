import 'server-only';

import type { Prisma } from '@prisma/client';
import {
  getRlsTransaction,
  setRlsContext,
  isRlsEnabled,
  withRlsBypass,
  type RlsContext,
} from '@/lib/apex/rlsContext';
import {
  appendAuditLogInTransaction,
  type AuditLogInput,
} from '@/lib/audit';
import { logger } from '@/lib/logger';

export class AuditedAccessError extends Error {
  readonly code = 'AUDITED_ACCESS_REQUIRED';

  constructor(message = 'Sensitive operation requires a durable audit entry') {
    super(message);
    this.name = 'AuditedAccessError';
  }
}

export interface WriteAuditedAccessOptions {
  /** Optional RLS context applied inside the same transaction before insert. */
  rls?: RlsContext;
  /** Existing interactive transaction — audit joins parent atomic unit. */
  tx?: Prisma.TransactionClient;
  /** Skip joining the ambient withSessionRls transaction (rare). */
  forceNewTransaction?: boolean;
}

/**
 * Fail-closed access audit for sensitive / PII routes.
 *
 * Always throws when the audit row cannot be persisted — the parent operation
 * must not succeed without a durable compliance entry (Phase 6.x fortress).
 *
 * Prefer this over writeAuditLog for owner context switches, RO mutations, story
 * pipeline events, and other paths where silent audit failure is unacceptable.
 *
 * When called inside withSessionRls / withRlsContext, the audit joins that
 * transaction automatically (unless forceNewTransaction is set).
 */
export async function writeAuditedAccess(
  input: AuditLogInput,
  options: WriteAuditedAccessOptions = {}
): Promise<string> {
  const run = async (tx: Prisma.TransactionClient): Promise<string> => {
    if (options.rls) {
      await setRlsContext(tx, options.rls);
    } else if (isRlsEnabled() || getRlsTransaction()) {
      await setRlsContext(tx, {
        technicianId: input.technicianId?.trim() || '',
        activeDealershipId: input.dealershipId?.trim() || null,
        dealerId: input.dealerId?.trim() || null,
        scopeMode: input.scopeMode === 'dealership' ? 'dealership' : 'national',
        enforced: true,
      });
    }

    const id = await appendAuditLogInTransaction(tx, input);
    if (!id?.trim()) {
      throw new AuditedAccessError('Audit log write returned empty id');
    }
    return id;
  };

  try {
    if (options.tx) {
      return await run(options.tx);
    }
    const ambient = options.forceNewTransaction ? undefined : getRlsTransaction();
    if (ambient) {
      return await run(ambient);
    }
    // Phase 7.1 H1 — no bare prisma; control-plane bypass when no ambient RLS tx
    return await withRlsBypass(async (tx) => run(tx));
  } catch (error) {
    logger.error('audit.audited_access_failed', {
      action: input.action,
      dealershipId: input.dealershipId,
      technicianId: input.technicianId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    if (error instanceof AuditedAccessError) throw error;
    if (error instanceof Error && error.message.startsWith('Audit log rejected:')) {
      throw error;
    }
    throw new AuditedAccessError(
      error instanceof Error
        ? `Audited access write failed for action "${input.action}": ${error.message}`
        : `Audited access write failed for action "${input.action}"`
    );
  }
}
