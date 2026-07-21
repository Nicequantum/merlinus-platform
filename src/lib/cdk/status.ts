/**
 * P3-3 — CDK Global live sync status (deferred).
 * Clipboard sanitize/copy remains available without the cdk_sync module.
 */

import 'server-only';

/** Reserved env names — not read for live calls until connector ships. */
export const CDK_LIVE_ENV_KEYS = [
  'CDK_GLOBAL_API_BASE',
  'CDK_GLOBAL_CLIENT_ID',
  'CDK_GLOBAL_CLIENT_SECRET',
  'CDK_SITE_CODE',
] as const;

/**
 * Live bi-directional CDK API sync is intentionally not available.
 * Returns true only when both implementation flag and credentials exist (future).
 */
export function isCdkLiveSyncAvailable(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  // Hard gate until a real connector is merged.
  if (env.CDK_LIVE_SYNC_IMPLEMENTED?.trim() !== 'true') {
    return false;
  }
  return CDK_LIVE_ENV_KEYS.every((k) => Boolean(env[k]?.trim()));
}

export function getCdkLiveSyncStatus(env: NodeJS.ProcessEnv = process.env): {
  available: boolean;
  deferred: boolean;
  reason: string;
  moduleId: 'cdk_sync';
  clipboardPasteAvailable: true;
} {
  if (isCdkLiveSyncAvailable(env)) {
    return {
      available: true,
      deferred: false,
      reason: 'Live CDK connector configured',
      moduleId: 'cdk_sync',
      clipboardPasteAvailable: true,
    };
  }
  return {
    available: false,
    deferred: true,
    reason:
      'CDK Global live sync is deferred. Use Copy for CDK / sanitized paste. Enable module only after credentials + legal + connector implementation.',
    moduleId: 'cdk_sync',
    clipboardPasteAvailable: true,
  };
}
