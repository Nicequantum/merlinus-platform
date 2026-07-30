import { withPublicRoute } from '@/lib/apiRoute';
import { VOICE_INPUT_SETTINGS } from '@/lib/constants';
import { getRuntimeConfig, isMaintenanceModeEnabled } from '@/lib/env';
import { PROMPT_VERSION } from '@/prompts/version';
import { resolveAppBaseUrlDetailed } from '@/lib/videoInspection/shareTokens';

export const dynamic = 'force-dynamic';

/**
 * Lightweight public status for client maintenance/offline banners and footer version.
 * P0-4: wrapped with withPublicRoute (rate limited + JSON errors).
 */
export async function GET(request: Request) {
  return withPublicRoute(
    request,
    async () => {
      const config = getRuntimeConfig(PROMPT_VERSION);
      const share = resolveAppBaseUrlDetailed(request);
      return {
        maintenance: isMaintenanceModeEnabled(),
        version: config.appVersion,
        promptVersion: config.promptVersion,
        buildCommit: config.buildCommit,
        buildDate: config.buildDate,
        voiceEnabled: VOICE_INPUT_SETTINGS.enabled,
        // Ops: confirm PUBLIC_SHARE_HOST is live (should be https://clarityautoapex.com)
        customerShareHost: share.origin,
        customerShareHostSource: share.source,
      };
    },
    { rateLimitKey: 'status.public', rateLimit: { limit: 120, windowMs: 60_000 } }
  );
}
