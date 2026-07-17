/**
 * Lightweight PATCH for a single repair line (notes / story / concern / description).
 * Avoids full-document PUT on every keystroke.
 */

import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { getRlsDb, rlsTransaction } from '@/lib/apex/rlsContext';
import { appendAuditLogInTransaction, auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { PROMPT_VERSION } from '@/prompts/version';
import {
  apiError,
  CONFLICT_ERROR,
  FORBIDDEN_ERROR,
  NOT_FOUND_ERROR,
} from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import {
  canAccessRepairOrder,
  scopedRepairLineWhereForSession,
  scopedRepairOrderWhereForSession,
} from '@/lib/repairOrderAccess';
import { dbToRepairLine } from '@/lib/roMapper';
import {
  encryptOptionalSensitiveText,
  encryptPII,
  encryptSensitiveText,
} from '@/lib/encryption';
import { sanitizeForCDK } from '@/lib/sanitizeForCDK';
import { CLEAR_STORY_CERTIFICATION_DB } from '@/lib/storyCertification';
import { hashWarrantyStory } from '@/lib/storyHash';
import { broadcastCompanionEvent } from '@/lib/companionBroadcast';
import {
  parseRequestBody,
  parseRouteParams,
  patchRepairLineSchema,
  repairOrderLineParamsSchema,
} from '@/lib/validation';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const routeParams = await parseRouteParams(repairOrderLineParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id, lineId } = routeParams.data;

  return withAuth(
    request,
    async (session) => {
      {
        const { effectiveRole } = await import('@/lib/apex/viewAs');
        if (effectiveRole(session) === 'service_advisor') {
          return apiError(FORBIDDEN_ERROR, 403);
        }
      }

      const parsed = await parseRequestBody(request, patchRepairLineSchema);
      if ('error' in parsed) return parsed.error;
      const data = parsed.data;

      const existing = await canAccessRepairOrder(session, id, { repairLines: true });
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      if (data.updatedAt && existing.updatedAt.toISOString() !== data.updatedAt) {
        return apiError(CONFLICT_ERROR, 409);
      }

      const existingLine = existing.repairLines.find((l) => l.id === lineId);
      if (!existingLine) return apiError(NOT_FOUND_ERROR, 404);

      const mappedLine = dbToRepairLine(existingLine);
      const dealerFields = dealerIdWriteFields(resolveDealerIdForWrite({ session }));
      const nextStoryText =
        data.warrantyStory !== undefined
          ? sanitizeForCDK(data.warrantyStory)
          : undefined;

      await rlsTransaction(async (tx) => {
        const patchData: Record<string, unknown> = {
          ...dealerFields,
        };
        if (data.description !== undefined) {
          patchData.descriptionEncrypted = encryptSensitiveText(data.description);
        }
        if (data.customerConcern !== undefined) {
          patchData.customerConcernEncrypted = encryptPII(data.customerConcern);
        }
        if (data.technicianNotes !== undefined) {
          patchData.technicianNotesEncrypted = encryptSensitiveText(data.technicianNotes);
        }
        if (nextStoryText !== undefined) {
          patchData.warrantyStoryEncrypted = encryptOptionalSensitiveText(nextStoryText);
          const prevHash = (existingLine as { storyCertifiedHash?: string | null }).storyCertifiedHash;
          if (prevHash?.trim() && (mappedLine.warrantyStory?.trim() ?? '') !== nextStoryText.trim()) {
            Object.assign(patchData, CLEAR_STORY_CERTIFICATION_DB);
          }
        }

        const updated = await tx.repairLine.updateMany({
          where: scopedRepairLineWhereForSession(lineId, id, session),
          data: patchData,
        });
        if (updated.count === 0) {
          throw new Error('Repair line not found for patch');
        }

        // Bump parent RO updatedAt for concurrency token
        await tx.repairOrder.updateMany({
          where: scopedRepairOrderWhereForSession(id, session),
          data: { ...dealerFields },
        });

        if (
          nextStoryText !== undefined &&
          (mappedLine.warrantyStory?.trim() ?? '') !== nextStoryText.trim() &&
          !mappedLine.isCustomerPay
        ) {
          await appendAuditLogInTransaction(tx, {
            action: 'story.edit',
            dealershipId: session.dealershipId,
            dealerId: dealerFields.dealerId,
            technicianId: session.technicianId,
            entityType: 'repairLine',
            entityId: lineId,
            promptVersion: PROMPT_VERSION,
            metadata: {
              repairOrderId: id,
              lineNumber: existingLine.lineNumber,
              promptVersion: PROMPT_VERSION,
              previousStoryHash: hashWarrantyStory(mappedLine.warrantyStory ?? ''),
              storyHash: hashWarrantyStory(nextStoryText),
            },
            ipAddress: getRequestIp(request),
          });
        }
      });

      const db = getRlsDb();
      const [lineRow, roRow] = await Promise.all([
        db.repairLine.findFirst({
          where: scopedRepairLineWhereForSession(lineId, id, session),
        }),
        db.repairOrder.findFirst({
          where: scopedRepairOrderWhereForSession(id, session),
          select: { updatedAt: true },
        }),
      ]);
      if (!lineRow || !roRow) return apiError(NOT_FOUND_ERROR, 404);

      await writeAuditedAccess({
        action: 'ro.update',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'repairLine',
        entityId: lineId,
        metadata: { repairOrderId: id, lineNumber: lineRow.lineNumber, patch: true },
        ipAddress: getRequestIp(request),
      });

      void broadcastCompanionEvent(session.technicianId, {
        type: 'ro.refresh',
        repairOrderId: id,
      });

      return {
        line: dbToRepairLine(lineRow),
        updatedAt: roRow.updatedAt.toISOString(),
      };
    },
    {
      rateLimitKey: 'ros.line.patch',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}
