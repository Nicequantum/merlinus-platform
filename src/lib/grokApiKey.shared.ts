/**
 * Server-only xAI Grok API key resolution.
 *
 * Operator multi-key layout (Cloudflare Worker secrets / env):
 *
 * | Env var           | Slot      | Features |
 * |-------------------|-----------|----------|
 * | GROK_API_KEY      | default   | Warranty story generate/score/review, customer-pay narrative, video MPI report, Hub insights, health probe, Apex proxy upstream |
 * | GROK_API_KEY_1    | vision    | RO photo extract, Xentry/diagnostics vision extract |
 * | GROK_API_KEY_2    | voice     | Sophia voice chat tools, realtime WebSocket |
 *
 * Fallbacks (when a slot secret is unset):
 *   vision → GROK_API_KEY
 *   voice  → GROK_API_KEY, then legacy XAI_API_KEY
 *
 * Never use NEXT_PUBLIC_* for xAI keys.
 */

/** xAI keys that must NEVER be prefixed with NEXT_PUBLIC_ — they expose secrets to the browser. */
export const FORBIDDEN_PUBLIC_GROK_ENV_KEYS = [
  'NEXT_PUBLIC_GROK_API_KEY',
  'NEXT_PUBLIC_XAI_API_KEY',
  'NEXT_PUBLIC_XAI_KEY',
] as const;

/** @deprecated Use FORBIDDEN_PUBLIC_GROK_ENV_KEYS */
const PUBLIC_GROK_ENV_KEYS = FORBIDDEN_PUBLIC_GROK_ENV_KEYS;

/** Logical purpose slots for multi-key routing. */
export type GrokKeySlot = 'default' | 'vision' | 'voice';

/**
 * Ordered env var candidates per slot (first non-empty wins).
 * Keep in sync with docs and operator secrets.
 */
export const GROK_KEY_SLOT_ENV_VARS: Record<GrokKeySlot, readonly string[]> = {
  default: ['GROK_API_KEY'],
  vision: ['GROK_API_KEY_1', 'GROK_API_KEY'],
  voice: ['GROK_API_KEY_2', 'GROK_API_KEY', 'XAI_API_KEY'],
} as const;

export const GROK_KEY_SLOT_LABELS: Record<GrokKeySlot, string> = {
  default: 'stories / hub / general completions',
  vision: 'RO + Xentry vision extract',
  voice: 'Sophia voice + realtime',
};

export function getExposedPublicGrokEnvKeys(): string[] {
  return FORBIDDEN_PUBLIC_GROK_ENV_KEYS.filter((name) => Boolean(process.env[name]?.trim()));
}

export function assertNoPublicGrokKeyExposure(): void {
  const exposed = getExposedPublicGrokEnvKeys();
  if (exposed.length > 0) {
    throw new Error(
      `${exposed.join(', ')} must not be set. Remove xAI API keys from frontend environment variables and use server-only GROK_API_KEY / GROK_API_KEY_1 / GROK_API_KEY_2 instead.`
    );
  }
}

export type GrokKeyResolution = {
  slot: GrokKeySlot;
  /** Env var name that supplied the key (for logs / health — not the secret value). */
  envVar: string;
  key: string;
  /** True when a purpose-specific key was missing and default/legacy was used. */
  usedFallback: boolean;
};

/**
 * Resolve an xAI key for a purpose slot.
 * Prefer purpose-specific secrets; fall back only as documented in GROK_KEY_SLOT_ENV_VARS.
 */
export function resolveGrokApiKey(slot: GrokKeySlot = 'default'): GrokKeyResolution {
  assertNoPublicGrokKeyExposure();
  const candidates = GROK_KEY_SLOT_ENV_VARS[slot];
  const primary = candidates[0]!;

  for (let i = 0; i < candidates.length; i++) {
    const envVar = candidates[i]!;
    const key = process.env[envVar]?.trim();
    if (key) {
      return {
        slot,
        envVar,
        key,
        usedFallback: envVar !== primary,
      };
    }
  }

  const tried = candidates.join(', ');
  throw new Error(
    slot === 'default'
      ? 'GROK_API_KEY is not configured on the server'
      : `No xAI key for slot "${slot}" (checked ${tried})`
  );
}

/** Server-only xAI key for the given slot — never use NEXT_PUBLIC_* variants. */
export function getGrokApiKeyForSlot(slot: GrokKeySlot = 'default'): string {
  return resolveGrokApiKey(slot).key;
}

/**
 * Default / basic key (stories, hub, general).
 * @deprecated Prefer getGrokApiKeyForSlot('default') when purpose is known.
 */
export function getGrokApiKey(): string {
  return getGrokApiKeyForSlot('default');
}

/** Vision extract key (GROK_API_KEY_1 → GROK_API_KEY). */
export function getGrokVisionApiKey(): string {
  return getGrokApiKeyForSlot('vision');
}

/** Voice / Sophia key (GROK_API_KEY_2 → GROK_API_KEY → XAI_API_KEY). */
export function getGrokVoiceApiKey(): string {
  return getGrokApiKeyForSlot('voice');
}

/** Safe ops summary — never returns secret material beyond last 4 chars. */
export function describeGrokKeySlot(slot: GrokKeySlot): {
  slot: GrokKeySlot;
  label: string;
  primaryEnv: string;
  configured: boolean;
  envVarUsed: string | null;
  usedFallback: boolean;
  keySuffix: string | null;
} {
  const primaryEnv = GROK_KEY_SLOT_ENV_VARS[slot][0]!;
  try {
    const resolved = resolveGrokApiKey(slot);
    return {
      slot,
      label: GROK_KEY_SLOT_LABELS[slot],
      primaryEnv,
      configured: true,
      envVarUsed: resolved.envVar,
      usedFallback: resolved.usedFallback,
      keySuffix: resolved.key.length >= 4 ? resolved.key.slice(-4) : '****',
    };
  } catch {
    return {
      slot,
      label: GROK_KEY_SLOT_LABELS[slot],
      primaryEnv,
      configured: false,
      envVarUsed: null,
      usedFallback: false,
      keySuffix: null,
    };
  }
}

export function describeAllGrokKeySlots(): ReturnType<typeof describeGrokKeySlot>[] {
  return (['default', 'vision', 'voice'] as const).map(describeGrokKeySlot);
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
    return getGrokApiKeyForSlot('default');
  } catch {
    const proxyKey = getGrokProxyApiKey();
    if (proxyKey) return proxyKey;
    throw new Error('GROK_API_KEY or GROK_PROXY_API_KEY is required for Grok proxy upstream calls');
  }
}

export { PUBLIC_GROK_ENV_KEYS };
