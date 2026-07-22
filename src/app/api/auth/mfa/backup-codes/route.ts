/**
 * POST /api/auth/mfa/backup-codes — regenerate emergency backup codes (requires TOTP).
 * Manager/owner self-service recovery codes only (not for bay techs typically).
 */
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { regenerateBackupCodes } from '@/lib/mfa/service';
import { RATE_LIMITS, getRequestIp } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().trim().min(6).max(12),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const role = (session.role || '').toLowerCase();
      const elevated =
        role === 'manager' || role === 'owner' || session.isAdmin || role === 'admin';
      if (!elevated) {
        return apiError('Backup code management is available for managers and owners.', 403);
      }

      try {
        const { backupCodes } = await regenerateBackupCodes({
          technicianId: session.technicianId,
          totpCode: parsed.data.code,
        });

        await writeAuditedAccess({
          action: 'auth.mfa_backup_regenerate',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'technician',
          entityId: session.technicianId,
          ipAddress: getRequestIp(request),
          metadata: { count: backupCodes.length },
        });

        return {
          ok: true,
          backupCodes,
          message: 'New backup codes issued. Previous codes no longer work. Store these securely.',
        };
      } catch (error) {
        return apiError(error instanceof Error ? error.message : String(error), 401);
      }
    },
    {
      rateLimitKey: 'auth.mfa.backup',
      rateLimit: RATE_LIMITS.authMfa,
      skipMfa: true,
      requireDealershipContext: false,
      useRls: false,
    }
  );
}
