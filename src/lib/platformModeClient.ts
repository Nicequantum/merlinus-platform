import { parsePlatformMode, type PlatformMode } from '@/lib/platformMode';

/**
 * Client-safe platform mode — mirrors server PLATFORM_MODE via NEXT_PUBLIC_PLATFORM_MODE.
 * Merlinus installs leave both unset; Apex sets PLATFORM_MODE=apex and NEXT_PUBLIC_PLATFORM_MODE=apex.
 */
export function getClientPlatformMode(): PlatformMode {
  return parsePlatformMode(process.env.NEXT_PUBLIC_PLATFORM_MODE);
}

export function isClientApexPlatformMode(): boolean {
  return getClientPlatformMode() === 'apex';
}

export function isClientMerlinusPlatformMode(): boolean {
  return getClientPlatformMode() === 'merlinus';
}