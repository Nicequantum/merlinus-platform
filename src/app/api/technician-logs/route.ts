import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { writeTechnicianActivityLog } from '@/lib/technicianActivityLog';

import { parseRequestBody, technicianAppStartLogSchema } from '@/lib/validation';

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, technicianAppStartLogSchema);
      if ('error' in parsed) return parsed.error;

      const { clientSessionId, metadata } = parsed.data;

      const launchedAt = new Date();

      await writeTechnicianActivityLog({
        dealershipId: session.dealershipId,
        dealerId: resolveDealerIdForWrite({ session }),
        technicianId: session.technicianId,
        category: 'app_start',
        event: 'app.ready',
        message: 'Merlin session ready — repair orders loaded',
        clientSessionId,
        metadata: {
          role: metadata?.role ?? session.role,
          todayRoCount: metadata?.todayRoCount,
          previousRoCount: metadata?.previousRoCount,
          appVersion: metadata?.appVersion,
          clientSessionId,
        },
      });

      await getRlsDb().technician.updateMany({
        where: { id: session.technicianId, firstAppLaunchAt: null },
        data: {
          firstAppLaunchAt: launchedAt,
          firstAppLaunchSessionId: clientSessionId,
        },
      });

      return { ok: true };
    },
    { rateLimitKey: 'technician_logs.ingest', skipConsent: false }
  );
}