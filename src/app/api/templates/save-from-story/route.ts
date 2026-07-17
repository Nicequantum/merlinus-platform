import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { saveTemplateFromStory } from '@/lib/saveTemplateFromStory';
import { parseRequestBody, saveTemplateFromStorySchema } from '@/lib/validation';

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, saveTemplateFromStorySchema);
      if ('error' in parsed) return parsed.error;

      const data = parsed.data;
      if (!data.finalText.trim()) {
        return apiError('Template story text cannot be empty.', 400);
      }

      const result = await saveTemplateFromStory({
        title: data.title,
        category: data.category,
        finalText: data.finalText,
        generatedText: data.generatedText,
        dealershipId: session.dealershipId,
        dealerId: resolveDealerIdForWrite({ session }),
        createdById: session.technicianId,
        lineDescription: data.lineDescription,
        vehicleMake: data.vehicleMake,
        vehicleModel: data.vehicleModel,
        codes: data.codes,
      });

      await writeAuditedAccess({
        action: 'template.save',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'template',
        entityId: result.template.id,
        metadata: {
          title: data.title,
          category: data.category,
          repairOrderId: data.repairOrderId ?? null,
          lineId: data.lineId ?? null,
          tagCount: result.tags.length,
        },
        ipAddress: getRequestIp(request),
      });

      return result;
    },
    {
      rateLimitKey: 'templates.save',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}