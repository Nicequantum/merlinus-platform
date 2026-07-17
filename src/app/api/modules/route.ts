import { NextResponse } from 'next/server';
import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { scopedPiiWhere } from '@/lib/apex/tenantScope';
import { withAuth } from '@/lib/apiRoute';
import { writeAuditLog } from '@/lib/audit';
import { apiError } from '@/lib/errors';
import {
  isProductModuleId,
  listModuleStatuses,
  setDealershipModuleEnabled,
} from '@/lib/modules';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

/**
 * PR-M0 + polish — Manager module entitlement status for the active rooftop.
 * GET: list effective status (force_env → dealership → group → default).
 * PATCH: enable/disable a product module for this rooftop (writes DealershipModule).
 * core_story is never a product module and cannot be toggled here.
 */

const patchSchema = z.object({
  moduleId: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
});

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const { dealershipId } = scopedPiiWhere(session);
      const modules = await listModuleStatuses(dealershipId);
      return NextResponse.json({
        dealershipId,
        modules,
        /** Explicit reminder: core story is never a product module flag. */
        coreStoryAlwaysOn: true,
      });
    },
    {
      rateLimitKey: 'modules.list',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}

export async function PATCH(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, patchSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      if (!isProductModuleId(parsed.data.moduleId)) {
        return apiError('Unknown product module', 400);
      }

      const { dealershipId } = scopedPiiWhere(session);
      const result = await setDealershipModuleEnabled(
        dealershipId,
        parsed.data.moduleId,
        parsed.data.enabled,
        { enabledById: session.technicianId }
      );

      await writeAuditLog({
        action: 'module.set',
        dealershipId,
        dealerId: resolveDealerIdForWrite({ session }) ?? undefined,
        technicianId: session.technicianId,
        entityType: 'dealershipModule',
        entityId: `${dealershipId}:${parsed.data.moduleId}`,
        metadata: {
          moduleId: parsed.data.moduleId,
          requestedEnabled: parsed.data.enabled,
          effectiveEnabled: result.enabled,
          source: result.status.source,
          forceEnvActive: result.forceEnvActive,
        },
      });

      const modules = await listModuleStatuses(dealershipId);
      return NextResponse.json({
        dealershipId,
        modules,
        coreStoryAlwaysOn: true as const,
        updated: {
          moduleId: result.moduleId,
          enabled: result.enabled,
          source: result.status.source,
          forceEnvActive: result.forceEnvActive,
        },
      });
    },
    {
      rateLimitKey: 'modules.set',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
