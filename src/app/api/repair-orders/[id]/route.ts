import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { getRlsDb, rlsTransaction } from '@/lib/apex/rlsContext';
import { appendAuditLogInTransaction, auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { PROMPT_VERSION } from '@/prompts/version';
import { withAuth } from '@/lib/apiRoute';
import {
  captureAdvisorIntelligence,
  type AdvisorExtractionSource,
} from '@/lib/advisorIntelligence';
import { collectRepairOrderImagePathnames, findForbiddenImagePathname } from '@/lib/imageAccess';
import { dbToRepairOrder, normalizeImageAttachments, repairLineToDbFields, repairOrderToDbFields } from '@/lib/roMapper';
import { readRoNumberFromDb } from '@/lib/piiFieldRead';
import { apiError, CONFLICT_ERROR, FORBIDDEN_ERROR, NOT_FOUND_ERROR, VALIDATION_ERROR } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getRequestIp } from '@/lib/rate-limit';
import { LARGE_JSON_BODY_LIMIT_BYTES } from '@/lib/requestBody';
import { parseRequestBody, parseRouteParams, routeIdParamsSchema, updateRepairOrderSchema } from '@/lib/validation';
import {
  canAccessRepairOrder,
  scopedRepairLineWhereForSession,
  scopedRepairOrderWhereForSession,
} from '@/lib/repairOrderAccess';
import { enrichRepairOrderCertification } from '@/lib/repairOrderCertificationEnrichment';
import { CLEAR_STORY_CERTIFICATION_DB } from '@/lib/storyCertification';
import { broadcastCompanionEvent } from '@/lib/companionBroadcast';
import { hashWarrantyStory } from '@/lib/storyHash';
import { emptyExtractedData } from '@/utils/diagnosticParser';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await parseRouteParams(routeIdParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id } = routeParams.data;
  return withAuth(
    request,
    async (session) => {
      const ro = await canAccessRepairOrder(session, id);
      if (!ro) return apiError(NOT_FOUND_ERROR, 404);

      const full = await getRlsDb().repairOrder.findFirst({
        where: scopedRepairOrderWhereForSession(id, session),
        include: {
          repairLines: true,
          serviceAdvisor: { select: { id: true, displayNameEncrypted: true } },
        },
      });
      if (!full) return apiError(NOT_FOUND_ERROR, 404);

      const mapped = dbToRepairOrder(full);
      const repairOrder = await enrichRepairOrderCertification(mapped, session.dealershipId);

      // Phase 6.2 — fail-closed PII read audit (entity-level RO access)
      await writeAuditedAccess({
        action: 'ro.read',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'repairOrder',
        entityId: id,
        metadata: { roNumber: readRoNumberFromDb(full) },
        ipAddress: getRequestIp(request),
      });

      return { repairOrder };
    },
    {
      rateLimitKey: 'ros.get',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await parseRouteParams(routeIdParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id } = routeParams.data;
  return withAuth(
    request,
    async (session) => {
      {
        const { effectiveRole } = await import('@/lib/apex/viewAs');
        if (effectiveRole(session) === 'service_advisor') {
          return apiError(FORBIDDEN_ERROR, 403);
        }
      }

      const existing = await canAccessRepairOrder(session, id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      const parsed = await parseRequestBody(request, updateRepairOrderSchema, LARGE_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const data = parsed.data;
      const existingMapped = dbToRepairOrder(existing);
      const input = {
        roNumber: data.roNumber ?? existingMapped.roNumber,
        vehicle: {
          vin: data.vehicle?.vin ?? existingMapped.vehicle.vin,
          year: data.vehicle?.year ?? existing.year,
          make: data.vehicle?.make ?? existing.make,
          model: data.vehicle?.model ?? existing.model,
          engine: data.vehicle?.engine ?? existing.engine,
          mileageIn: data.vehicle?.mileageIn ?? existing.mileageIn,
          mileageOut: data.vehicle?.mileageOut ?? existing.mileageOut,
        },
        customer: data.customer ?? { name: existingMapped.customer.name },
        complaints: data.complaints ?? existingMapped.complaints,
        complaintLabels: data.complaintLabels ?? existingMapped.complaintLabels,
        xentryImages: data.xentryImages ? normalizeImageAttachments(data.xentryImages) : undefined,
        xentryOcrTexts: data.xentryOcrTexts ?? existingMapped.xentryOcrTexts,
        repairLines: data.repairLines,
      };

      const warrantyStoryEdits: Array<{
        lineId: string;
        lineNumber: number;
        previousStoryHash: string;
        storyHash: string;
      }> = [];
      const customerPayStoryEdits: Array<{ lineId: string; lineNumber: number }> = [];
      if (data.repairLines) {
        for (const line of data.repairLines) {
          if (!line.id || line.warrantyStory === undefined) continue;
          const prev = existingMapped.repairLines.find((l) => l.id === line.id);
          const existingLine = existing.repairLines.find((l) => l.id === line.id);
          if (prev && prev.warrantyStory !== line.warrantyStory) {
            const isCustomerPay =
              line.isCustomerPay === true || existingLine?.isCustomerPay === true;
            if (isCustomerPay) {
              customerPayStoryEdits.push({
                lineId: line.id,
                lineNumber: prev.lineNumber,
              });
            } else {
              warrantyStoryEdits.push({
                lineId: line.id,
                lineNumber: prev.lineNumber,
                previousStoryHash: hashWarrantyStory(prev.warrantyStory ?? ''),
                storyHash: hashWarrantyStory(line.warrantyStory ?? ''),
              });
            }
          }
        }
      }

      const extractionSource: AdvisorExtractionSource = data.advisorExtractionSource || 'manual';
      const advisorNameToCapture = data.serviceAdvisorName || existingMapped.serviceAdvisorName;

      let forbiddenPathname: string | null;
      try {
        forbiddenPathname = await findForbiddenImagePathname(
          session,
          collectRepairOrderImagePathnames({
            xentryImages: data.xentryImages ? normalizeImageAttachments(data.xentryImages) : [],
            repairLines: data.repairLines
              ? data.repairLines
                  .filter((line) => line.id)
                  .map((line) => ({
                    xentryImages: normalizeImageAttachments(line.xentryImages),
                  }))
              : [],
          })
        );
      } catch (error) {
        logger.error('ros.update.image_access_failed', {
          technicianId: session.technicianId,
          dealershipId: session.dealershipId,
          repairOrderId: id,
          error: error instanceof Error ? error.message : 'unknown',
        });
        return apiError('Unable to verify image attachments.', 500);
      }
      if (forbiddenPathname) {
        return apiError(FORBIDDEN_ERROR, 403);
      }

      if (data.updatedAt && existing.updatedAt.toISOString() !== data.updatedAt) {
        return apiError(CONFLICT_ERROR, 409);
      }

      // APEX NATIONAL PLATFORM — stamp dealerId on writes from authenticated session when present.
      const dealerFields = dealerIdWriteFields(resolveDealerIdForWrite({ session }));

      const advisorCapture = await rlsTransaction(async (tx) => {
        const roUpdated = await tx.repairOrder.updateMany({
          where: scopedRepairOrderWhereForSession(id, session),
          data: {
            ...repairOrderToDbFields(input as Parameters<typeof repairOrderToDbFields>[0]),
            ...dealerFields,
          },
        });
        if (roUpdated.count === 0) {
          throw new Error('Repair order not found for update');
        }

        const requestIp = getRequestIp(request);
        // Parallel audit writes for story edits (was serial N+1)
        await Promise.all(
          warrantyStoryEdits.map((edit) =>
            appendAuditLogInTransaction(tx, {
              action: 'story.edit',
              dealershipId: session.dealershipId,
              dealerId: dealerFields.dealerId,
              technicianId: session.technicianId,
              entityType: 'repairLine',
              entityId: edit.lineId,
              promptVersion: PROMPT_VERSION,
              metadata: {
                repairOrderId: id,
                lineNumber: edit.lineNumber,
                promptVersion: PROMPT_VERSION,
                previousStoryHash: edit.previousStoryHash,
                storyHash: edit.storyHash,
              },
              ipAddress: requestIp,
            })
          )
        );

        if (data.repairLines && Array.isArray(data.repairLines)) {
          // Parallel line upserts — was serial updateMany/create per line (N+1 under load)
          await Promise.all(
            data.repairLines.map(async (line) => {
              if (!line.id) return;
              const existingLine = existing.repairLines.find((l) => l.id === line.id);
              const existingMappedLine = existingMapped.repairLines.find((l) => l.id === line.id);
              // M1: explicit clearCustomerPay or dedicated clear endpoint strips the flag;
              // omitted/false alone cannot accidentally clear a persisted Customer Pay line.
              const isCustomerPay =
                line.clearCustomerPay === true
                  ? false
                  : line.isCustomerPay === true || existingLine?.isCustomerPay === true;
              const storyQualityAudit = line.clearStoryQualityAudit
                ? null
                : existingMappedLine?.storyQualityAudit ?? null;

              const lineFields = repairLineToDbFields({
                id: line.id,
                lineNumber: line.lineNumber || 1,
                description: line.description || 'Enter repair description',
                customerConcern: line.customerConcern || '',
                technicianNotes: line.technicianNotes || '',
                xentryImages: normalizeImageAttachments(line.xentryImages),
                xentryOcrTexts: line.xentryOcrTexts || [],
                extractedData: { ...emptyExtractedData(), ...line.extractedData },
                warrantyStory: line.warrantyStory,
                storyQualityAudit,
                isCustomerPay,
              });

              const previousStory = existingMappedLine?.warrantyStory?.trim() ?? '';
              const nextStory = line.warrantyStory?.trim() ?? '';
              const certificationCleared =
                previousStory !== nextStory &&
                existingLine &&
                Boolean(
                  (existingLine as { storyCertifiedHash?: string }).storyCertifiedHash?.trim()
                );

              if (existingLine) {
                await tx.repairLine.updateMany({
                  where: scopedRepairLineWhereForSession(line.id, id, session),
                  data: {
                    ...lineFields,
                    ...dealerFields,
                    ...(certificationCleared ? CLEAR_STORY_CERTIFICATION_DB : {}),
                  },
                });
              } else {
                await tx.repairLine.create({
                  data: {
                    id: line.id,
                    repairOrderId: id,
                    ...lineFields,
                    ...dealerFields,
                  },
                });
              }
            })
          );

          const incomingIds = new Set(data.repairLines.map((l) => l.id).filter(Boolean));
          const dbLines = await tx.repairLine.findMany({
            where: {
              repairOrderId: id,
              repairOrder: { dealershipId: session.dealershipId },
            },
          });
          await Promise.all(
            dbLines
              .filter((dbLine) => !incomingIds.has(dbLine.id))
              .map((dbLine) =>
                tx.repairLine.deleteMany({
                  where: scopedRepairLineWhereForSession(dbLine.id, id, session),
                })
              )
          );
        }

        if (!advisorNameToCapture) {
          return null;
        }

        return captureAdvisorIntelligence(
          {
            dealershipId: session.dealershipId,
            dealerId: dealerFields.dealerId,
            repairOrderId: id,
            serviceAdvisorName: advisorNameToCapture,
            complaints: input.complaints,
            complaintLabels: input.complaintLabels,
            vehicle: {
              make: input.vehicle.make,
              model: input.vehicle.model,
            },
            extractionSource,
            wasCorrected: data.complaintsWereCorrected ?? false,
          },
          tx
        );
      });

      if (advisorCapture?.serviceAdvisor) {
        await writeAuditedAccess({
          action: 'advisor.capture',
          dealershipId: session.dealershipId,
          dealerId: dealerFields.dealerId,
          technicianId: session.technicianId,
          entityType: 'serviceAdvisor',
          entityId: advisorCapture.serviceAdvisor.id,
          metadata: {
            repairOrderId: id,
            roNumber: input.roNumber,
            observationCount: input.complaints.length,
            wasCorrected: data.complaintsWereCorrected ?? false,
          },
          ipAddress: getRequestIp(request),
        });
      }

      const updated = await getRlsDb().repairOrder.findFirst({
        where: scopedRepairOrderWhereForSession(id, session),
        include: {
          repairLines: true,
          serviceAdvisor: { select: { id: true, displayNameEncrypted: true } },
        },
      });
      if (!updated) return apiError(NOT_FOUND_ERROR, 404);

      await writeAuditedAccess({
        action: 'ro.update',
        dealershipId: session.dealershipId,
        dealerId: dealerFields.dealerId,
        technicianId: session.technicianId,
        entityType: 'repairOrder',
        entityId: id,
        // S2: audit stores roNumber as operational identifier (not customer PII) — see schema migration plan.
        metadata: { roNumber: readRoNumberFromDb(updated) },
        ipAddress: getRequestIp(request),
      });

      for (const edit of customerPayStoryEdits) {
        await writeAuditedAccess({
          action: 'customerPayStory.edit',
          dealershipId: session.dealershipId,
          dealerId: dealerFields.dealerId,
          technicianId: session.technicianId,
          entityType: 'repairLine',
          entityId: edit.lineId,
          metadata: { repairOrderId: id, lineNumber: edit.lineNumber },
          ipAddress: getRequestIp(request),
        });
      }

      void broadcastCompanionEvent(session.technicianId, {
        type: 'ro.refresh',
        repairOrderId: id,
        reason: 'ro.update',
      });

      return { repairOrder: dbToRepairOrder(updated) };
    },
    {
      rateLimitKey: 'ros.update',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await parseRouteParams(routeIdParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id } = routeParams.data;
  return withAuth(
    request,
    async (session) => {
      {
        const { effectiveRole } = await import('@/lib/apex/viewAs');
        if (effectiveRole(session) === 'service_advisor') {
          return apiError(FORBIDDEN_ERROR, 403);
        }
      }

      const existing = await canAccessRepairOrder(session, id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      await getRlsDb().repairOrder.deleteMany({
        where: scopedRepairOrderWhereForSession(id, session),
      });

      await writeAuditedAccess({
        action: 'ro.delete',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'repairOrder',
        entityId: id,
        // S2: audit stores roNumber as operational identifier (not customer PII) — see schema migration plan.
        metadata: { roNumber: readRoNumberFromDb(existing) },
        ipAddress: getRequestIp(request),
      });

      return { ok: true };
    },
    {
      rateLimitKey: 'ros.delete',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}