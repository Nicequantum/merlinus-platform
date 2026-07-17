const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_REGEX = /^[0-9a-f:]+$/i;

function isValidIp(value: string): boolean {
  return IPV4_REGEX.test(value) || (value.includes(':') && IPV6_REGEX.test(value));
}

/**
 * M14: Prefer platform-trusted headers; do not blindly trust client-spoofable X-Forwarded-For leftmost hop.
 */
export function getClientIp(request: Request): string {
  const vercel = request.headers.get('x-vercel-forwarded-for')?.trim();
  if (vercel && isValidIp(vercel)) return vercel;

  const cf = request.headers.get('cf-connecting-ip')?.trim();
  if (cf && isValidIp(cf)) return cf;

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp && isValidIp(realIp)) return realIp;

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    const trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? '1');
    const index = Math.max(0, hops.length - trustedHops);
    const candidate = hops[index];
    if (candidate && isValidIp(candidate)) return candidate;
  }

  return 'unknown';
}

export function getRequestIp(request: Request): string {
  return getClientIp(request);
}