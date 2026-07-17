/** xAI keys that must NEVER be prefixed with NEXT_PUBLIC_ — they expose secrets to the browser. */
export const FORBIDDEN_PUBLIC_GROK_ENV_KEYS = [
  'NEXT_PUBLIC_GROK_API_KEY',
  'NEXT_PUBLIC_XAI_API_KEY',
  'NEXT_PUBLIC_XAI_KEY',
] as const;

/** @deprecated Use FORBIDDEN_PUBLIC_GROK_ENV_KEYS */
const PUBLIC_GROK_ENV_KEYS = FORBIDDEN_PUBLIC_GROK_ENV_KEYS;

export function getExposedPublicGrokEnvKeys(): string[] {
  return FORBIDDEN_PUBLIC_GROK_ENV_KEYS.filter((name) => Boolean(process.env[name]?.trim()));
}

export function assertNoPublicGrokKeyExposure(): void {
  const exposed = getExposedPublicGrokEnvKeys();
  if (exposed.length > 0) {
    throw new Error(
      `${exposed.join(', ')} must not be set. Remove xAI API keys from frontend environment variables and use server-only GROK_API_KEY instead.`
    );
  }
}

/** Server-only xAI key — never use NEXT_PUBLIC_* variants. */
export function getGrokApiKey(): string {
  assertNoPublicGrokKeyExposure();
  const key = process.env.GROK_API_KEY?.trim();
  if (!key) {
    throw new Error('GROK_API_KEY is not configured on the server');
  }
  return key;
}

/** Apex national platform — optional shared secret for /api/grok/proxy inbound auth. */
export function getGrokProxyApiKey(): string | null {
  return process.env.GROK_PROXY_API_KEY?.trim() || null;
}

export function isGrokProxyConfigured(): boolean {
  return Boolean(getGrokProxyApiKey());
}

/**
 * Apex national platform — optional base URL for the centralized Grok proxy host.
 * When unset, server-side callers default to same-origin `/api/grok/proxy`.
 */
export function getGrokProxyBaseUrl(): string | null {
  const configured = process.env.GROK_PROXY_URL?.trim();
  return configured ? configured.replace(/\/$/, '') : null;
}

/** Upstream xAI key used by the Apex proxy route when forwarding to api.x.ai. */
export function getGrokProxyUpstreamApiKey(): string {
  try {
    return getGrokApiKey();
  } catch {
    const proxyKey = getGrokProxyApiKey();
    if (proxyKey) return proxyKey;
    throw new Error('GROK_API_KEY or GROK_PROXY_API_KEY is required for Grok proxy upstream calls');
  }
}

export { PUBLIC_GROK_ENV_KEYS };