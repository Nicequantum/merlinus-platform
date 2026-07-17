export function buildImageProxyUrl(pathname: string): string {
  return `/api/images?pathname=${encodeURIComponent(pathname)}`;
}

export function extractPathnameFromImageRef(value: string): string | null {
  if (!value) return null;
  if (value.startsWith('benz-tech/')) return value;
  try {
    const url = value.startsWith('http') ? new URL(value) : new URL(value, 'http://localhost');
    const pathname = url.searchParams.get('pathname');
    if (pathname?.startsWith('benz-tech/')) return pathname;
  } catch {
    return null;
  }
  return null;
}

export function isAllowedImagePathname(pathname: string): boolean {
  return pathname.startsWith('benz-tech/') && !pathname.includes('..');
}