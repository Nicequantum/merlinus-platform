import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb, rlsTransaction } from '@/lib/apex/rlsContext';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import {
  captureAdvisorIntelligence,
  type AdvisorExtractionSource,
} from '@/lib/advisorIntelligence';
import {
  dbToRepairOrder,
  dbToRepairOrderSummary,
  normalizeImageAttachments,
  repairLineToDbFields,
  repairOrderToDbFields,
  type RepairOrderInput,
} from '@/lib/roMapper';
import { readRoNumberFromDb } from '@/lib/piiFieldRead';
import { collectRepairOrderImagePathnames, findForbiddenImagePathname } from '@/lib/imageAccess';
import { apiError, FORBIDDEN_ERROR, handleRouteError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getRequestIp } from '@/lib/rate-limit';
import { LARGE_JSON_BODY_LIMIT_BYTES } from '@/lib/requestBody';
import { createRepairOrderSchema, parseRequestBody } from '@/lib/validation';
import { emptyExtractedData } from '@/utils/diagnosticParser';
import { buildRepairOrderListWhere, getTodayStartIso } from '@/lib/roListQuery';
import { parseQueryParams, repairOrderListQuerySchema } from '@/lib/validation';
import { createRepairOrderFromScan } from '@/utils/repairOrderFactory';
import {
  findIdempotentRepairOrderCreate,
  idempotencyMetadata,
  readIdempotencyKeyFromRequest,
} from '@/lib/roCreateIdempotency';

export async function GET(request: Request) {
  const query = parseQueryParams(request, repairOrderListQuerySchema);
  if ('error' in query) return query.error;

  return withAuth(
    request,
    async (session) => {
      const params = query.data;
      const where = buildRepairOrderListWhere(session, params);

      const db = getRlsDb();
      // Slim select for list — never pull full encrypted story/notes/OCR/image payloads.
      // hasWarrantyStory only needs presence of warrantyStoryEncrypted ciphertext.
      const orders = await db.repairOrder.findMany({
        where,
        select: {
          id: true,
          roNumberEncrypted: true,
          year: true,
          make: true,
          model: true,
          complaintsEncrypted: true,
          createdAt: true,
          updatedAt: true,
          technicianId: true,
          technician: { select: { name: true } },
          repairLines: {
            select: {
              id: true,
              lineNumber: true,
              isCustomerPay: true,
              warrantyStoryEncrypted: true,
              soldLaborHours: true,
              soldLaborAmount: true,
              soldPartsAmount: true,
              customerApproved: true,
              isAddOn: true,
              soldMetricsUpdatedAt: true,
            },
            orderBy: { lineNumber: 'asc' },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: params.limit + 1,
        ...(params.cursor
          ? {
              cursor: { id: params.cursor },
              skip: 1,
            }
          : {}),
      });

      const hasMore = orders.length > params.limit;
      const page = hasMore ? orders.slice(0, params.limit) : orders;

      // Partial select is enough for summary mapping (only presence of ciphertext for hasWarrantyStory).
      const repairOrders = page.map((ro) =>
        dbToRepairOrderSummary(ro as Parameters<typeof dbToRepairOrderSummary>[0])
      );

      // Phase 6.3 — fail-closed bulk PII list audit (no RO numbers in metadata).
      await writeAuditedAccess({
        action: 'ro.list',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'repair_order_list',
        entityId: session.dealershipId,
        metadata: {
          resultCount: repairOrders.length,
          limit: params.limit,
          hasMore,
          scope: params.q ? 'search' : params.scope,
          hasCursor: Boolean(params.cursor),
        },
        ipAddress: getRequestIp(request),
      });

      return {
        repairOrders,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
        scope: params.q ? 'search' : params.scope,
        todayStart: getTodayStartIso(),
      };
    },
    {
      rateLimitKey: 'ros.list',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      {
        const { effectiveRole } = await import('@/lib/apex/viewAs');
        if (effectiveRole(session) === 'service_advisor') {
          return apiError(FORBIDDEN_ERROR, 403);
        }
      }

      const parsed = await parseRequestBody(request, createRepairOrderSchema, LARGE_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const idempotencyKey = readIdempotencyKeyFromRequest(request);

      const data = parsed.data;
      let input: RepairOrderInput;

      if (data.fromExtraction) {
        const ro = await createRepairOrderFromScan({
          roNumber: data.roNumber || `R-${Date.now().toString().slice(-6)}`,
          vehicle: {
            vin: data.vehicle?.vin || '',
            year: data.vehicle?.year || '',
            make: data.vehicle?.make || '',
            model: data.vehicle?.model || '',
            engine: data.vehicle?.engine || '',
            mileageIn: data.vehicle?.mileageIn || '',
            mileageOut: data.vehicle?.mileageOut || '',
          },
          customerName: data.customerName || data.customer?.name || '',
          complaints: data.complaints || [],
          complaintLabels: data.complaintLabels,
          serviceAdvisorName: data.serviceAdvisorName,
        });
        input = {
          roNumber: ro.roNumber,
          vehicle: ro.vehicle,
          customer: ro.customer,
          complaints: ro.complaints,
          complaintLabels: ro.complaintLabels,
          xentryImages: ro.xentryImages,
          xentryOcrTexts: ro.xentryOcrTexts,
          repairLines: ro.repairLines,
        };
      } else {
        input = {
          roNumber: data.roNumber || `R-${Date.now().toString().slice(-6)}`,
          vehicle: {
            vin: data.vehicle?.vin || '',
            year: data.vehicle?.year || '',
            make: data.vehicle?.make || '',
            model: data.vehicle?.model || '',
            engine: data.vehicle?.engine || '',
            mileageIn: data.vehicle?.mileageIn || '',
            mileageOut: data.vehicle?.mileageOut || '',
          },
          customer: { name: data.customer?.name || '' },
          complaints: data.complaints || [],
          xentryImages: normalizeImageAttachments(data.xentryImages),
          xentryOcrTexts: data.xentryOcrTexts || [],
          repairLines: (data.repairLines || []).map((l, i) => ({
            id: l.id || `temp-${i}`,
            lineNumber: l.lineNumber || i + 1,
            description: l.description || 'Enter repair description',
            customerConcern: l.customerConcern || '',
            technicianNotes: l.technicianNotes || '',
            xentryImages: normalizeImageAttachments(l.xentryImages),
            xentryOcrTexts: l.xentryOcrTexts || [],
            extractedData: { ...emptyExtractedData(), ...l.extractedData },
            warrantyStory: l.warrantyStory,
          })),
        };

        if (input.repairLines.length === 0) {
          input.repairLines = [
            {
              id: 'temp',
              lineNumber: 1,
              description: 'Enter repair description',
              customerConcern: '',
              technicianNotes: '',
              xentryImages: [],
              extractedData: emptyExtractedData(),
            },
          ];
        }
      }

      let forbiddenPathname: string | null;
      try {
        forbiddenPathname = await findForbiddenImagePathname(
          session,
          collectRepairOrderImagePathnames(input)
        );
      } catch (error) {
        logger.error('ros.create.image_access_failed', {
          technicianId: session.technicianId,
          dealershipId: session.dealershipId,
          error: error instanceof Error ? error.message : 'unknown',
        });
        return apiError('Unable to verify image attachments.', 500);
      }
      if (forbiddenPathname) {
        return apiError(FORBIDDEN_ERROR, 403);
      }

      const extractionSource: AdvisorExtractionSource =
        data.advisorExtractionSource || (data.fromExtraction ? 'grok' : 'manual');

      // APEX NATIONAL PLATFORM — stamp dealerId on writes from authenticated session only.
      const dealerId = resolveDealerIdForWrite({ session });

      let created;
      try {
        // Phase 6.2 — join ambient withSessionRls transaction (no nested non-RLS connection)
        const result = await rlsTransaction(async (tx) => {
          if (idempotencyKey) {
            const prior = await findIdempotentRepairOrderCreate(tx, {
              dealershipId: session.dealershipId,
              technicianId: session.technicianId,
              idempotencyKey,
            });
            if (prior) {
              return { created: null as null, advisorCapture: null, replay: prior };
            }
          }

          const ro = await tx.repairOrder.create({
            data: {
              ...repairOrderToDbFields(input),
              technicianId: session.technicianId,
              dealershipId: session.dealershipId,
              ...(dealerId ? { dealerId } : {}),
              repairLines: {
                create: input.repairLines.map((line) => ({
                  ...repairLineToDbFields(line),
                  ...(dealerId ? { dealerId } : {}),
                })),
              },
            },
            include: { repairLines: true, serviceAdvisor: { select: { id: true, displayNameEncrypted: true } } },
          });

          const capture = data.serviceAdvisorName
            ? await captureAdvisorIntelligence(
                {
                  dealershipId: session.dealershipId,
                  dealerId,
                  repairOrderId: ro.id,
                  serviceAdvisorName: data.serviceAdvisorName,
                  complaints: input.complaints,
                  complaintLabels: input.complaintLabels,
                  vehicle: {
                    make: input.vehicle.make,
                    model: input.vehicle.model,
                  },
                  extractionSource,
                },
                tx
              )
            : null;

          if (capture?.serviceAdvisor) {
            await writeAuditedAccess(
              {
                action: 'advisor.capture',
                dealershipId: session.dealershipId,
                dealerId: auditDealerIdFromSession(session),
                technicianId: session.technicianId,
                entityType: 'serviceAdvisor',
                entityId: capture.serviceAdvisor.id,
                metadata: {
                  repairOrderId: ro.id,
                  roNumber: readRoNumberFromDb(ro),
                  observationCount: input.complaints.length,
                  isNewAdvisor: capture.serviceAdvisor.isNew,
                },
                ipAddress: getRequestIp(request),
              },
              { tx }
            );
          }

          await writeAuditedAccess(
            {
              action: 'ro.create',
              dealershipId: session.dealershipId,
              dealerId: auditDealerIdFromSession(session),
              technicianId: session.technicianId,
              entityType: 'repairOrder',
              entityId: ro.id,
              metadata: {
                roNumber: readRoNumberFromDb(ro),
                ...(idempotencyKey ? idempotencyMetadata(idempotencyKey) : {}),
              },
              ipAddress: getRequestIp(request),
            },
            { tx }
          );

          const createdRo = await tx.repairOrder.findUniqueOrThrow({
            where: { id: ro.id },
            include: { repairLines: true, serviceAdvisor: { select: { id: true, displayNameEncrypted: true } } },
          });

          return { created: createdRo, advisorCapture: capture, replay: null as null };
        });

        if (result.replay) {
          return { repairOrder: result.replay, idempotent: true };
        }
        created = result.created!;
      } catch (error) {
        logger.error('ros.create.transaction_failed', {
          technicianId: session.technicianId,
          dealershipId: session.dealershipId,
          roNumber: input.roNumber,
          error: error instanceof Error ? error.message : 'unknown',
        });
        return handleRouteError(error, 'ros.create');
      }

      return { repairOrder: dbToRepairOrder(created) };
    },
    {
      rateLimitKey: 'ros.create',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}