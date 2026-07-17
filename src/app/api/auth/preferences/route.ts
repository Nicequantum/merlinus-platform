import { rlsContextFromSession, rlsTransaction } from '@/lib/apex/rlsContext';
import { appendAuditLogInTransaction, auditDealerIdFromSession } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import { normalizePreferredLanguage } from '@/lib/i18n/locales';
import { getRequestIp } from '@/lib/rate-limit';
import { jsonWithFreshSessionCookie, toTechnicianSession } from '@/lib/sessionRefresh';
import {
  AUTH_JSON_BODY_LIMIT_BYTES,
  parseRequestBody,
  updatePreferencesSchema,
} from '@/lib/validation';

/**
 * Self-service technician preferences (Phase 1 multilingual).
 * Updates only the authenticated technician's preferredLanguage.
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, updatePreferencesSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const preferredLanguage = normalizePreferredLanguage(parsed.data.preferredLanguage);

      await rlsTransaction(
        async (tx) => {
          await tx.technician.update({
            where: { id: session.technicianId },
            data: { preferredLanguage },
          });

          await appendAuditLogInTransaction(tx, {
            action: 'preferences.update',
            dealershipId: session.dealershipId,
            dealerId: auditDealerIdFromSession(session),
            technicianId: session.technicianId,
            entityType: 'technician',
            entityId: session.technicianId,
            metadata: {
              preferredLanguage,
              previousPreferredLanguage: session.preferredLanguage ?? 'en',
            },
            ipAddress: getRequestIp(request),
          });
        },
        rlsContextFromSession(session)
      );

      const refreshedSession = {
        ...session,
        preferredLanguage,
      };

      return jsonWithFreshSessionCookie(
        {
          preferredLanguage,
          session: toTechnicianSession(refreshedSession),
        },
        refreshedSession
      );
    },
    {
      rateLimitKey: 'auth.preferences',
      // Safe before consent/disclaimer/password change — only UI language preference.
      skipConsent: true,
      skipLegalDisclaimer: true,
      skipPasswordChange: true,
    }
  );
}
