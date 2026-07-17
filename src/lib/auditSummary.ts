import { scopedDealershipWhere } from '@/lib/apex/dealerScope';
import { computeAuditEntryHash, verifyAuditChain, type AuditChainPayload } from './auditChain';
import { getRlsDb } from '@/lib/apex/rlsContext';

export interface AuditSummaryScope {
  dealershipId: string;
  dealerId?: string | null;
}

/** H-3: Default chain verification window — avoids loading full dealership history. */
const DEFAULT_CHAIN_VERIFY_LIMIT = 500;

const chainLogSelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  technicianId: true,
  dealershipId: true,
  metadata: true,
  ipAddress: true,
  previousHash: true,
  entryHash: true,
  promptVersion: true,
  createdAt: true,
} as const;

export interface GetAuditDashboardSummaryOptions {
  /** When true, verify the entire hash chain. Default: most recent 500 hashed entries only. */
  verifyFullChain?: boolean;
}

/** H-3: Verify hash integrity and linkage within a window (no GENESIS check on first entry). */
function verifyAuditChainWindow(
  entries: Array<AuditChainPayload & { previousHash: string; entryHash: string }>
): { valid: boolean; brokenAt: number | null } {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (i > 0 && entry.previousHash !== entries[i - 1].entryHash) {
      return { valid: false, brokenAt: i };
    }
    if (computeAuditEntryHash(entry) !== entry.entryHash) {
      return { valid: false, brokenAt: i };
    }
  }
  return { valid: true, brokenAt: null };
}

async function loadChainLogsForVerification(
  scope: AuditSummaryScope,
  verifyFullChain: boolean
) {
  const where = { ...scopedDealershipWhere(scope.dealershipId, scope.dealerId), entryHash: { not: '' } };
  if (verifyFullChain) {
    return getRlsDb().auditLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: chainLogSelect,
    });
  }

  const recent = await getRlsDb().auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: DEFAULT_CHAIN_VERIFY_LIMIT,
    select: chainLogSelect,
  });
  return recent.reverse();
}

export interface AuditDashboardSummary {
  totalEntries: number;
  last24Hours: number;
  last7Days: number;
  actionCounts: Array<{ action: string; count: number }>;
  recentActivity: Array<{
    id: string;
    action: string;
    technicianName: string | null;
    createdAt: string;
  }>;
  chain: {
    enabled: true;
    description: string;
    hashedEntries: number;
    legacyEntries: number;
    valid: boolean;
    brokenAt: number | null;
    headHash: string | null;
    limitations: string[];
  };
}

export async function getAuditDashboardSummary(
  scope: AuditSummaryScope | string,
  options: GetAuditDashboardSummaryOptions = {}
): Promise<AuditDashboardSummary> {
  const resolvedScope: AuditSummaryScope =
    typeof scope === 'string' ? { dealershipId: scope } : scope;
  const { dealershipId, dealerId } = resolvedScope;
  const auditWhere = scopedDealershipWhere(dealershipId, dealerId);

  const verifyFullChain = options.verifyFullChain === true;
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalEntries, last24Hours, last7Days, grouped, recent, hashedEntryCount, legacyEntries, chainLogs] =
    await Promise.all([
    getRlsDb().auditLog.count({ where: auditWhere }),
    getRlsDb().auditLog.count({ where: { ...auditWhere, createdAt: { gte: dayAgo } } }),
    getRlsDb().auditLog.count({ where: { ...auditWhere, createdAt: { gte: weekAgo } } }),
    getRlsDb().auditLog.groupBy({
      by: ['action'],
      where: { ...auditWhere, createdAt: { gte: weekAgo } },
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
    }),
    getRlsDb().auditLog.findMany({
      where: auditWhere,
      include: { technician: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    getRlsDb().auditLog.count({ where: { ...auditWhere, entryHash: { not: '' } } }),
    getRlsDb().auditLog.count({
      where: {
        ...auditWhere,
        entryHash: '',
      },
    }),
    loadChainLogsForVerification(resolvedScope, verifyFullChain),
  ]);

  const hashed = chainLogs.filter((l) => l.entryHash);

  const chainPayload: Array<AuditChainPayload & { previousHash: string; entryHash: string }> = hashed.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    technicianId: log.technicianId,
    dealershipId: log.dealershipId,
    metadata: log.metadata,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt.toISOString(),
    previousHash: log.previousHash,
    entryHash: log.entryHash,
    promptVersion: log.promptVersion,
  }));

  const verification = verifyFullChain
    ? verifyAuditChain(chainPayload)
    : verifyAuditChainWindow(chainPayload);

  const chainLimitations = [
    'Chain verifies append-only integrity — it does not prevent a privileged database admin from rewriting the full table.',
    'Entries created before hash-chain rollout may appear as legacy (no entryHash).',
    'For legal defensibility, pair with database backups, access controls, and exported CSV archives.',
  ];
  if (!verifyFullChain && hashedEntryCount > DEFAULT_CHAIN_VERIFY_LIMIT) {
    chainLimitations.unshift(
      `Chain verification sampled the most recent ${DEFAULT_CHAIN_VERIFY_LIMIT} hashed entries (not full history). Pass verifyFullChain: true for a complete scan.`
    );
  }

  return {
    totalEntries,
    last24Hours,
    last7Days,
    actionCounts: grouped.map((g) => ({ action: g.action, count: g._count.action })),
    recentActivity: recent.map((log) => ({
      id: log.id,
      action: log.action,
      technicianName: log.technician?.name ?? null,
      createdAt: log.createdAt.toISOString(),
    })),
    chain: {
      enabled: true,
      description:
        'Each audit entry is SHA-256 linked to the previous entry per dealership. Tampering with a row breaks the chain from that point forward.',
      hashedEntries: hashedEntryCount,
      legacyEntries,
      valid: verification.valid,
      brokenAt: verification.brokenAt,
      headHash: hashed.length > 0 ? hashed[hashed.length - 1].entryHash : null,
      limitations: chainLimitations,
    },
  };
}