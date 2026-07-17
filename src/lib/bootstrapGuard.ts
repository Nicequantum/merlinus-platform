import { logger } from '@/lib/logger';
import { getRequestIp } from '@/lib/requestIp';
import { isBootstrapSeedAllowed, isProductionRuntime } from '@/lib/productionRuntime';

export const BOOTSTRAP_SEED_PATH = '/api/setup/seed';

export const BOOTSTRAP_PRODUCTION_BLOCKED_MESSAGE =
  'Database bootstrap is permanently disabled in production. Use prisma migrate and manual admin setup.';

export interface BootstrapBlockLogInput {
  request: Request;
  layer: 'middleware' | 'route';
  method?: string;
}

/** Security audit log — any production attempt to hit the seed endpoint. */
export function logBootstrapSeedBlockedAttempt(input: BootstrapBlockLogInput): void {
  const { request, layer, method = request.method } = input;
  logger.warn('bootstrap.seed.blocked_production', {
    layer,
    method,
    path: BOOTSTRAP_SEED_PATH,
    ipAddress: getRequestIp(request),
    userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    allowBootstrapEnv: process.env.ALLOW_BOOTSTRAP?.trim() ?? null,
    isProduction: isProductionRuntime(),
  });
}