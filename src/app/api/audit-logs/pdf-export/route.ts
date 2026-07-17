import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { PROMPT_VERSION } from '@/prompts/version';
import { withAuth } from '@/lib/apiRoute';
import { apiError, VALIDATION_ERROR } from '@/lib/errors';
import { canAccessRepairOrder } from '@/lib/repairOrderAccess';
import { getRequestIp } from '@/lib/rate-limit';
import { logPerformance } from '@/lib/perf';
import { parseRequestBody, pdfExportAuditSchema } from '@/lib/validation';

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, pdfExportAuditSchema);
      if ('error' in parsed) return parsed.error;

      const { repairLineId, repairOrderId, durationMs } = parsed.data;

      const ro = await canAccessRepairOrder(session, repairOrderId);
      if (!ro) {
        return apiError(VALIDATION_ERROR, 400);
      }

      const line = ro.repairLines.find((entry) => entry.id === repairLineId);
      if (!line) {
        return apiError(VALIDATION_ERROR, 400);
      }

      // H4: Customer Pay PDF exports use sentinel audit — not Merlin story.pdf_export.
      // Phase 6.3 — fail-closed export audit
      if (isCustomerPayRepairLine(line)) {
        await writeAuditedAccess({
          action: 'customerPayStory.pdf_export',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'repairLine',
          entityId: repairLineId,
          metadata: {
            repairOrderId,
            lineNumber: line.lineNumber,
          },
          ipAddress: getRequestIp(request),
        });
      } else {
        await writeAuditedAccess({
          action: 'story.pdf_export',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'repairLine',
          entityId: repairLineId,
          promptVersion: PROMPT_VERSION,
          metadata: {
            repairOrderId,
            lineNumber: line.lineNumber,
            promptVersion: PROMPT_VERSION,
          },
          ipAddress: getRequestIp(request),
        });
      }

      if (durationMs != null) {
        logPerformance('client.pdf.export', durationMs, {
          repairLineId,
          repairOrderId,
          technicianId: session.technicianId,
        });
      }

      return { ok: true };
    },
    {
      rateLimitKey: 'audit-logs.pdf-export',
      perfEvent: 'route.pdf.export.audit',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}