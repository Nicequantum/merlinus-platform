import { withPublicRoute } from '@/lib/apiRoute';
import { VOICE_INPUT_SETTINGS } from '@/lib/constants';
import { getRuntimeConfig, isMaintenanceModeEnabled } from '@/lib/env';
import { PROMPT_VERSION } from '@/prompts/version';

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
      return {
        maintenance: isMaintenanceModeEnabled(),
        version: config.appVersion,
        promptVersion: config.promptVersion,
        buildCommit: config.buildCommit,
        buildDate: config.buildDate,
        voiceEnabled: VOICE_INPUT_SETTINGS.enabled,
      };
    },
    { rateLimitKey: 'status.public', rateLimit: { limit: 120, windowMs: 60_000 } }
  );
}
