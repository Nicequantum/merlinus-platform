/**
 * Manager Personal Tailoring — list / save department customizations.
 */
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import {
  isTailoringDepartment,
  listDepartmentCustomizations,
  saveDepartmentCustomization,
  TAILORING_DEPARTMENTS,
  type TailoringDepartment,
} from '@/lib/voiceAgent/customization';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const items = await listDepartmentCustomizations(session.dealershipId);
      return {
        dealershipId: session.dealershipId,
        departments: TAILORING_DEPARTMENTS,
        customizations: items,
      };
    },
    {
      rateLimitKey: 'voice.customizations.list',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}

const putSchema = z.object({
  department: z.string().trim().min(1).max(32),
  customInstructions: z.string().max(8000).optional(),
  greeting: z.string().max(4000).optional(),
  disclaimers: z.string().max(4000).optional(),
  toneGuidelines: z.string().max(4000).optional(),
  changeNote: z.string().max(200).optional(),
});

export async function PUT(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, putSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;
      if (!isTailoringDepartment(parsed.data.department)) {
        return apiError('Unknown department for tailoring', 400);
      }
      const saved = await saveDepartmentCustomization({
        dealershipId: session.dealershipId,
        department: parsed.data.department as TailoringDepartment,
        customInstructions: parsed.data.customInstructions,
        greeting: parsed.data.greeting,
        disclaimers: parsed.data.disclaimers,
        toneGuidelines: parsed.data.toneGuidelines,
        actorTechnicianId: session.technicianId,
        changeNote: parsed.data.changeNote,
      });
      return { ok: true, customization: saved };
    },
    {
      rateLimitKey: 'voice.customizations.save',
      rateLimit: RATE_LIMITS.authMfa,
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
