import 'server-only';

import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { getRlsDb, rlsTransaction } from '@/lib/apex/rlsContext';
import { appendAuditLogInTransaction } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { encryptOptionalSensitiveText, decryptSensitiveText, decryptOptionalSensitiveText } from '@/lib/encryption';
import { GLOBAL_DEALERSHIP_ID } from '@/lib/templateLibrary';
import { sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';

export interface ApplyCustomerPayTemplateInput {
  repairOrderId: string;
  repairLineId: string;
  templateId: string;
  dealershipId: string;
  technicianId: string;
  /** APEX NATIONAL PLATFORM — optional franchise tenant stamp on repair-line writes. */
  dealerId?: string | null;
  ipAddress?: string;
}

export interface ApplyCustomerPayTemplateResult {
  warrantyStory: string;
  templateTitle: string;
  isCustomerPay: true;
  /** M3: true when apply was skipped because line already had this template story. */
  idempotent?: boolean;
  /** True when unsafe characters were stripped for CDK compatibility. */
  cdkSanitized?: boolean;
}

export interface ClearCustomerPayModeInput {
  repairOrderId: string;
  repairLineId: string;
  dealershipId: string;
  technicianId: string;
  /** APEX NATIONAL PLATFORM — optional franchise tenant stamp on repair-line writes. */
  dealerId?: string | null;
  ipAddress?: string;
}

/**
 * M1: Explicitly clear Customer Pay mode so warranty AI generation can resume.
 */
export async function clearCustomerPayMode(input: ClearCustomerPayModeInput): Promise<void> {
  // Phase 7.1 H1 — RLS-aware client (ambient withSessionRls when called from routes)
  const db = getRlsDb();
  const ro = await db.repairOrder.findFirst({
    where: { id: input.repairOrderId, dealershipId: input.dealershipId },
    include: { repairLines: true },
  });
  if (!ro) throw new Error('Repair order not found');
  const line = ro.repairLines.find((l) => l.id === input.repairLineId);
  if (!line) throw new Error('Repair line not found');

  await rlsTransaction(async (tx) => {
    await tx.repairLine.updateMany({
      where: {
        id: input.repairLineId,
        repairOrder: { id: input.repairOrderId, dealershipId: input.dealershipId },
      },
      data: {
        isCustomerPay: false,
        ...dealerIdWriteFields(input.dealerId),
      },
    });
  });

  // Phase 6.3 — fail-closed clear audit
  await writeAuditedAccess({
    action: 'customerPay.clear',
    dealershipId: input.dealershipId,
    dealerId: input.dealerId,
    technicianId: input.technicianId,
    entityType: 'repairLine',
    entityId: input.repairLineId,
    metadata: { repairOrderId: input.repairOrderId },
    ipAddress: input.ipAddress,
  });
}

/** M3: Skip duplicate audit/usage when the same template story is already on the line. */
async function isDuplicateTemplateApply(
  line: { isCustomerPay: boolean; warrantyStoryEncrypted: string | null },
  templateId: string,
  repairLineId: string,
  dealershipId: string,
  preWrittenStory: string
): Promise<boolean> {
  if (!line.isCustomerPay) return false;
  const existingStory = decryptOptionalSensitiveText(line.warrantyStoryEncrypted);
  if (existingStory !== preWrittenStory) return false;

  const recent = await getRlsDb().auditLog.findFirst({
    where: {
      action: 'customerPayTemplateApplied',
      entityId: repairLineId,
      dealershipId,
      createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
      metadata: { contains: `"templateId":"${templateId}"` },
    },
    orderBy: { createdAt: 'desc' },
  });
  return Boolean(recent);
}

/**
 * Apply a Customer Pay template to a repair line.
 * Customer Pay bypasses Grok — instant pre-written stories with lightweight audit only.
 * M2: Line update, usage counter, and audit run in one transaction.
 * M3: Idempotent when the same template story is already applied.
 */
export async function applyCustomerPayTemplate(
  input: ApplyCustomerPayTemplateInput
): Promise<ApplyCustomerPayTemplateResult> {
  const db = getRlsDb();
  const template = await db.template.findFirst({
    where: {
      id: input.templateId,
      OR: [{ dealershipId: input.dealershipId }, { dealershipId: GLOBAL_DEALERSHIP_ID }],
    },
  });

  if (!template) {
    throw new Error('Template not found');
  }

  if (!template.isCustomerPay) {
    throw new Error('This template is not a Customer Pay template');
  }

  const ro = await db.repairOrder.findFirst({
    where: { id: input.repairOrderId, dealershipId: input.dealershipId },
    include: { repairLines: true },
  });

  if (!ro) {
    throw new Error('Repair order not found');
  }

  const line = ro.repairLines.find((l) => l.id === input.repairLineId);
  if (!line) {
    throw new Error('Repair line not found');
  }

  const templateStory = decryptSensitiveText(template.contentEncrypted);
  const { text: preWrittenStory, wasModified: cdkSanitized } = sanitizeForCDKWithMeta(templateStory);

  if (
    await isDuplicateTemplateApply(
      line,
      template.id,
      input.repairLineId,
      input.dealershipId,
      preWrittenStory
    )
  ) {
    return {
      warrantyStory: preWrittenStory,
      templateTitle: template.title,
      isCustomerPay: true,
      idempotent: true,
      cdkSanitized,
    };
  }

  const encryptedStory = encryptOptionalSensitiveText(preWrittenStory);

  // M2 + Phase 6.3: atomic apply under RLS when ambient withSessionRls is active
  await rlsTransaction(
    async (tx) => {
      await tx.repairLine.updateMany({
        where: {
          id: input.repairLineId,
          repairOrder: { id: input.repairOrderId, dealershipId: input.dealershipId },
        },
        data: {
          warrantyStoryEncrypted: encryptedStory,
          isCustomerPay: true,
          // APEX NATIONAL PLATFORM — stamp dealerId from authenticated session when present.
          ...dealerIdWriteFields(input.dealerId),
        },
      });

      await tx.template.updateMany({
        where: {
          id: input.templateId,
          OR: [{ dealershipId: input.dealershipId }, { dealershipId: GLOBAL_DEALERSHIP_ID }],
        },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      });

      await appendAuditLogInTransaction(tx, {
        action: 'customerPayTemplateApplied',
        dealershipId: input.dealershipId,
        dealerId: input.dealerId,
        technicianId: input.technicianId,
        entityType: 'repairLine',
        entityId: input.repairLineId,
        metadata: {
          templateId: template.id,
          templateTitle: template.title,
          repairOrderId: input.repairOrderId,
        },
        ipAddress: input.ipAddress,
      });
    },
    {
      technicianId: input.technicianId,
      activeDealershipId: input.dealershipId,
      dealerId: input.dealerId ?? null,
      scopeMode: 'dealership',
      enforced: true,
    }
  );

  return {
    warrantyStory: preWrittenStory,
    templateTitle: template.title,
    isCustomerPay: true,
    cdkSanitized,
  };
}