/**
 * APEX NATIONAL PLATFORM — deployment mode (no server-only deps; safe for unit tests).
 *
 * PLATFORM_MODE controls national Apex vs single-dealer Merlinus experience:
 * - merlinus (default): legacy D7 login and Tiverton behavior
 * - apex: unified credential login and national platform features
 *
 * Resolution order:
 * 1. PLATFORM_MODE
 * 2. NEXT_PUBLIC_PLATFORM_MODE (client mirror / Next public env)
 * 3. APEX_ENV=1|true|yes → apex (local `npm run dev:apex` / Apex deploys)
 * 4. merlinus
 */

export const PLATFORM_MODES = ['merlinus', 'apex'] as const;
export type PlatformMode = (typeof PLATFORM_MODES)[number];

function isTruthyApexEnv(value: string | undefined | null): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function parsePlatformMode(raw: string | undefined | null): PlatformMode {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return 'merlinus';
  if ((PLATFORM_MODES as readonly string[]).includes(normalized)) {
    return normalized as PlatformMode;
  }
  throw new Error(`Invalid PLATFORM_MODE "${raw}" — expected merlinus or apex`);
}

export function getPlatformMode(): PlatformMode {
  const explicit = process.env.PLATFORM_MODE?.trim();
  if (explicit) {
    return parsePlatformMode(explicit);
  }

  const publicMode = process.env.NEXT_PUBLIC_PLATFORM_MODE?.trim();
  if (publicMode) {
    return parsePlatformMode(publicMode);
  }

  // Apex local/dev and Apex-oriented deploys set APEX_ENV without always stamping PLATFORM_MODE
  // into .env.local — treat that as national platform mode so email owner login hits the
  // unified resolver and apex_* session cookies are used.
  if (isTruthyApexEnv(process.env.APEX_ENV)) {
    return 'apex';
  }

  return 'merlinus';
}

export function isApexPlatformMode(): boolean {
  return getPlatformMode() === 'apex';
}

export function isMerlinusPlatformMode(): boolean {
  return getPlatformMode() === 'merlinus';
}
