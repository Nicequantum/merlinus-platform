import { rlsContextFromSession, rlsTransaction } from '@/lib/apex/rlsContext';
import { appendAuditLogInTransaction, auditDealerIdFromSession } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';

import { getRequestIp } from '@/lib/rate-limit';
import { jsonWithFreshSessionCookie, toTechnicianSession } from '@/lib/sessionRefresh';
import { CONSENT_VERSION } from '@/types';

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const now = new Date();

      // Phase 7.1 H1 — ambient/session RLS transaction (no bare prisma)
      await rlsTransaction(
        async (tx) => {
          await tx.technician.update({
            where: { id: session.technicianId },
            data: { consentAt: now, consentVersion: CONSENT_VERSION },
          });

          await appendAuditLogInTransaction(tx, {
            action: 'consent.accept',
            dealershipId: session.dealershipId,
            dealerId: auditDealerIdFromSession(session),
            technicianId: session.technicianId,
            entityType: 'technician',
            entityId: session.technicianId,
            metadata: { consentVersion: CONSENT_VERSION },
            ipAddress: getRequestIp(request),
          });
        },
        rlsContextFromSession(session)
      );

      const refreshedSession = {
        ...session,
        consentAt: now.toISOString(),
        consentVersion: CONSENT_VERSION,
      };

      return jsonWithFreshSessionCookie(
        {
          consentAt: now.toISOString(),
          consentVersion: CONSENT_VERSION,
          session: toTechnicianSession(refreshedSession),
        },
        refreshedSession
      );
    },
    { rateLimitKey: 'consent', skipConsent: true, skipLegalDisclaimer: true }
  );
}