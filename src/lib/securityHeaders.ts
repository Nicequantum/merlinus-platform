/**
 * Security header helpers shared by middleware and unit tests.
 * Same-origin dealership deployment — cross-origin API access is denied.
 */

export function isCrossOriginRequest(requestOrigin: string | null, hostOrigin: string): boolean {
  if (!requestOrigin) return false;
  try {
    return new URL(requestOrigin).origin !== hostOrigin;
  } catch {
    return true;
  }
}

export function applySecurityHeaders(
  headers: Headers,
  entries: ReadonlyArray<{ key: string; value: string }>
): void {
  for (const { key, value } of entries) {
    headers.set(key, value);
  }
}