import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { resolveDealerIdForWrite, type DealerAwareSession } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { PROMPT_VERSION } from '@/prompts/version';
import { withRlsBypass } from '@/lib/apex/rlsContext';
import { sanitizeAuditMetadata } from './auditMetadataSanitize';
import {
  AUDIT_CUSTOMER_PAY_SENTINEL,
  AUDIT_GENESIS_HASH,
  AUDIT_LEGACY_PROMPT_VERSION,
  AUDIT_NON_AI_PROMPT_VERSION,
  computeAuditEntryHash,
} from './auditChain';
import { logger } from './logger';

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.refresh'
  | 'auth.select_dealership'
  | 'owner.dealership_enter'
  | 'owner.dealership_exit'
  | 'owner.national_access'
  | 'auth.password_change'
  | 'auth.mfa_enroll_start'
  | 'auth.mfa_enroll_complete'
  | 'auth.mfa_challenge'
  | 'auth.mfa_success'
  | 'auth.mfa_failure'
  | 'auth.mfa_backup_used'
  | 'auth.mfa_backup_regenerate'
  | 'auth.clerk_link'
  | 'consent.accept'
  | 'legalDisclaimer.accept'
  | 'preferences.update'
  | 'ro.create'
  | 'ro.read'
  | 'ro.list'
  | 'ro.update'
  | 'ro.delete'
  | 'ro.extract'
  | 'audit.access'
  | 'auth.session_revoke'
  | 'diagnostics.extract'
  | 'story.generate'
  | 'story.score'
  | 'story.review'
  | 'story.edit'
  | 'story.certify'
  | 'story.pdf_export'
  | 'user.create'
  | 'user.deactivate'
  | 'user.reactivate'
  | 'user.delete'
  | 'user.password_reset'
  | 'image.upload'
  | 'video.upload'
  | 'video.report_generate'
  | 'video.share_create'
  | 'video.sms_send'
  | 'video.public_view'
  | 'advisor.resolve'
  | 'advisor.capture'
  | 'advisor.create'
  | 'advisor.deactivate'
  | 'advisor.reactivate'
  | 'advisor.delete'
  | 'advisor.sold_metrics'
  | 'template.save'
  | 'template.use'
  | 'customerPay.clear'
  | 'customerPayTemplateApplied'
  | 'customerPayStory.edit'
  | 'customerPayStory.pdf_export'
  /** Apex control-plane — new franchise/rooftop provision (metadata must be PII-free). */
  | 'dealer.provision'
  /** Manager toggled a product module for the active rooftop. */
  | 'module.set'
  /** Manager updated Sophia department personal tailoring. */
  | 'voice.customization_update'
  | 'encryption.rotation_begin'
  | 'encryption.rotation_env_confirmed'
  | 'encryption.rotation_reencrypt_start'
  | 'encryption.rotation_cancel'
  | 'encryption.rotation_complete';

/** Customer Pay — lightweight audit; no Merlin promptVersion. */
export const CUSTOMER_PAY_AUDIT_ACTIONS: ReadonlySet<AuditAction> = new Set([
  'customerPay.clear',
  'customerPayTemplateApplied',
  'customerPayStory.edit',
  'customerPayStory.pdf_export',
]);

/**
 * Compliance-critical audit actions — DB write failure must abort the parent operation (C2).
 * Non-critical actions (e.g. ro.update, image.upload) may log and continue.
 */
/** Upload audit must succeed — extract routes grant access from this entry. */
export const UPLOAD_AUDIT_ACTIONS: ReadonlySet<AuditAction> = new Set(['image.upload']);

export const CRITICAL_AUDIT_ACTIONS: ReadonlySet<AuditAction> = new Set([
  'auth.login',
  'auth.logout',
  'auth.refresh',
  'auth.select_dealership',
  'owner.dealership_enter',
  'owner.dealership_exit',
  'owner.national_access',
  'auth.password_change',
  'auth.mfa_enroll_complete',
  'auth.mfa_success',
  'auth.mfa_failure',
  'consent.accept',
  'legalDisclaimer.accept',
  /** Phase 6.x — fail-closed via writeAuditedAccess on sensitive paths. */
  'ro.create',
  'ro.read',
  'ro.list',
  'ro.update',
  'ro.delete',
  'ro.extract',
  'audit.access',
  'auth.session_revoke',
  'diagnostics.extract',
  'story.generate',
  'story.score',
  'story.review',
  'story.edit',
  'story.certify',
  'customerPayTemplateApplied',
  'customerPayStory.edit',
  'customerPayStory.pdf_export',
  'customerPay.clear',
  'story.pdf_export',
  'image.upload',
  'advisor.sold_metrics',
  'user.deactivate',
  'user.delete',
  'user.password_reset',
  'user.reactivate',
  'user.create',
  'advisor.create',
  'advisor.deactivate',
  'advisor.reactivate',
  'advisor.delete',
  'advisor.resolve',
  'template.save',
  'template.use',
  'auth.clerk_link',
  'dealer.provision',
  'module.set',
]);

/** AI warranty story actions must record the active Merlin PROMPT_VERSION for audit defensibility. */
export const STORY_PROMPT_AUDIT_ACTIONS: ReadonlySet<AuditAction> = new Set([
  'story.generate',
  'story.score',
  'story.review',
  'story.edit',
  'story.certify',
  'story.pdf_export',
]);

/** APEX NATIONAL PLATFORM — optional dealerId for audit entries from authenticated session. */
export function auditDealerIdFromSession(session: DealerAwareSession): string | undefined {
  return dealerIdWriteFields(resolveDealerIdForWrite({ session })).dealerId;
}

export interface AuditLogInput {
  action: AuditAction;
  dealershipId: string;
  /** APEX NATIONAL PLATFORM — optional franchise tenant stamp on audit entries. */
  dealerId?: string | null;
  technicianId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  /** APEX Phase 5 — identity provider: legacy | clerk | refresh. */
  authSource?: string | null;
  /** APEX Phase 5 — session scope at event time: national | dealership. */
  scopeMode?: string | null;
  /**
   * Merlin prompt version stamped on this audit entry.
   * Required on every write — auto-filled for story actions when omitted.
   */
  promptVersion?: string;
}

/**
 * Warranty auditors use promptVersion to prove which Merlin instruction set produced
 * an AI-generated story, review, edit trail, or PDF export at a point in time.
 */
function resolvePromptVersion(input: AuditLogInput): string {
  const explicit = input.promptVersion?.trim();
  if (explicit) return explicit;
  if (CUSTOMER_PAY_AUDIT_ACTIONS.has(input.action)) return AUDIT_CUSTOMER_PAY_SENTINEL;
  if (STORY_PROMPT_AUDIT_ACTIONS.has(input.action)) return PROMPT_VERSION;
  return AUDIT_NON_AI_PROMPT_VERSION;
}

/** Fail loudly — missing or invalid promptVersion breaks compliance traceability. */
function assertPromptVersionValid(action: AuditAction, promptVersion: string): void {
  if (!promptVersion?.trim()) {
    throw new Error(`Audit log rejected: promptVersion is required for action "${action}"`);
  }

  if (STORY_PROMPT_AUDIT_ACTIONS.has(action)) {
    if (promptVersion === AUDIT_NON_AI_PROMPT_VERSION || promptVersion === AUDIT_LEGACY_PROMPT_VERSION) {
      throw new Error(
        `Audit log rejected: story action "${action}" requires active Merlin prompt version, got "${promptVersion}"`
      );
    }
  }

  if (CUSTOMER_PAY_AUDIT_ACTIONS.has(action) && promptVersion === PROMPT_VERSION) {
    throw new Error(
      `Audit log rejected: customer pay action "${action}" must not use Merlin prompt version`
    );
  }
}

export interface CustomerPayTemplateAuditInput {
  dealershipId: string;
  dealerId?: string | null;
  technicianId: string;
  repairLineId: string;
  repairOrderId: string;
  templateId: string;
  templateTitle: string;
  ipAddress?: string;
}

/**
 * Lightweight audit for Customer Pay template application.
 * Does not record Merlin PROMPT_VERSION — non-warranty work is outside AI compliance scope.
 */
export async function writeCustomerPayTemplateAudit(input: CustomerPayTemplateAuditInput): Promise<void> {
  const { writeAuditedAccess } = await import('@/lib/auditedAccess');
  await writeAuditedAccess({
    action: 'customerPayTemplateApplied',
    dealershipId: input.dealershipId,
    dealerId: input.dealerId,
    technicianId: input.technicianId,
    entityType: 'repairLine',
    entityId: input.repairLineId,
    metadata: {
      templateId: input.templateId,
      templateTitle: input.templateTitle,
      repairOrderId: input.repairOrderId,
    },
    ipAddress: input.ipAddress,
  });
}

/**
 * M2: Append audit inside an existing transaction (e.g. Customer Pay template apply).
 * M13: Metadata is sanitized before persistence.
 */
export async function appendAuditLogInTransaction(
  tx: Prisma.TransactionClient,
  input: AuditLogInput,
  createdAt = new Date()
): Promise<string> {
  const promptVersion = resolvePromptVersion(input);
  assertPromptVersionValid(input.action, promptVersion);
  const metadata = JSON.stringify(sanitizeAuditMetadata(input.metadata, input.action));

  // H5: Postgres advisory locks are unavailable on D1/SQLite.
  // Hash-chain integrity still relies on sequential writes + previousHash; concurrent
  // forks are rare under single-primary D1 write semantics.

  const last = await tx.auditLog.findFirst({
    where: { dealershipId: input.dealershipId },
    orderBy: { createdAt: 'desc' },
    select: { entryHash: true },
  });

  const previousHash = last?.entryHash || AUDIT_GENESIS_HASH;
  const id = randomUUID();
  const entryHash = computeAuditEntryHash({
    id,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    technicianId: input.technicianId ?? null,
    dealershipId: input.dealershipId,
    metadata,
    ipAddress: input.ipAddress ?? null,
    createdAt: createdAt.toISOString(),
    previousHash,
    promptVersion,
  });

  await tx.auditLog.create({
    data: {
      id,
      action: input.action,
      dealershipId: input.dealershipId,
      ...(input.dealerId?.trim() ? { dealerId: input.dealerId.trim() } : {}),
      technicianId: input.technicianId,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata,
      ipAddress: input.ipAddress,
      authSource: input.authSource?.trim() || null,
      scopeMode: input.scopeMode?.trim() || null,
      promptVersion,
      previousHash,
      entryHash,
      createdAt,
    },
  });

  return id;
}

export async function writeAuditLog(input: AuditLogInput): Promise<string | void> {
  try {
    // Phase 7.1 H1 — RLS-bypass transaction (no bare prisma)
    return await withRlsBypass(async (tx) => {
      return appendAuditLogInTransaction(tx, input);
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Audit log rejected:')) {
      throw error;
    }
    logger.error('audit.write_failed', {
      action: input.action,
      dealershipId: input.dealershipId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    // C2: warranty/auth compliance actions must not succeed without a durable audit entry.
    if (CRITICAL_AUDIT_ACTIONS.has(input.action) || UPLOAD_AUDIT_ACTIONS.has(input.action)) {
      throw error instanceof Error
        ? error
        : new Error(`Critical audit log write failed for action "${input.action}"`);
    }
  }
}