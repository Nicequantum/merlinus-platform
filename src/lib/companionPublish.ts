const DEVICE_HEADER = 'x-companion-device-id';

export function getCompanionDeviceIdFromRequest(
  request: Request,
  body?: Record<string, unknown>
): string {
  const header = request.headers.get(DEVICE_HEADER)?.trim();
  if (header) return header;
  const fromBody = typeof body?.sourceDeviceId === 'string' ? body.sourceDeviceId.trim() : '';
  return fromBody || 'client';
}

export const COMPANION_DEVICE_HEADER = DEVICE_HEADER;