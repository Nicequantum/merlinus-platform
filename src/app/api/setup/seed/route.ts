import { NextResponse } from 'next/server';
import {
  BOOTSTRAP_PRODUCTION_BLOCKED_MESSAGE,
  logBootstrapSeedBlockedAttempt,
} from '@/lib/bootstrapGuard';
import { apiError, handleRouteError } from '@/lib/errors';
import { isBootstrapSeedAllowed } from '@/lib/productionRuntime';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { runDatabaseSeed } from '@/lib/seedDatabase';

export const dynamic = 'force-dynamic';

function authorizeSetup(request: Request): boolean {
  const expected = process.env.SETUP_SECRET?.trim();
  if (!expected) return false;

  const auth = request.headers.get('authorization')?.trim();
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() === expected;
  }

  return false;
}

export async function POST(request: Request) {
  const rateLimited = await checkRateLimit(request, 'setup.seed', RATE_LIMITS.auth);
  if (rateLimited) return rateLimited;

  if (!isBootstrapSeedAllowed()) {
    logBootstrapSeedBlockedAttempt({ request, layer: 'route' });
    return apiError(BOOTSTRAP_PRODUCTION_BLOCKED_MESSAGE, 403);
  }

  if (!authorizeSetup(request)) {
    return apiError('Unauthorized — valid SETUP_SECRET bearer token required.', 401);
  }

  try {
    const result = await runDatabaseSeed();
    return NextResponse.json({
      ok: true,
      managerD7: result.managerD7,
      techD7: result.techD7,
      templates: result.templates,
      knowledgeBase: result.knowledgeBase,
    });
  } catch (error) {
    return handleRouteError(error, 'setup.seed');
  }
}