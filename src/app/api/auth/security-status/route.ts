import { checkSeedPasswordSecurity } from '@/lib/seedSecurity';
import { withAuth } from '@/lib/apiRoute';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withAuth(
    request,
    async () => {
      const status = await checkSeedPasswordSecurity();
      return Response.json(
        {
          usingDefaultSeedPasswords: status.usingDefaultSeedPasswords,
          warnings: status.warnings,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },
    { rateLimitKey: 'auth.security-status', requireManager: true }
  );
}