import { logger } from './logger';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isWriteHttpMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

/** Structured request log for mutating API calls — complements hash-chained audit entries. */
export function logApiWriteRequest(input: {
  routeKey: string;
  method: string;
  status: number;
  durationMs: number;
  technicianId?: string;
  dealershipId?: string;
  failed?: boolean;
}): void {
  if (!isWriteHttpMethod(input.method)) return;

  logger.info('api.write', {
    routeKey: input.routeKey,
    method: input.method.toUpperCase(),
    status: input.status,
    durationMs: input.durationMs,
    technicianId: input.technicianId,
    dealershipId: input.dealershipId,
    failed: input.failed ?? input.status >= 400,
  });
}