/**
 * P3-2 — Premium realtime voice path configuration.
 *
 * Production pilot default: Twilio <Gather> + Grok chat tools (Workerd-safe).
 * Realtime WebSocket (xAI) is optional premium / Node sidecar only.
 *
 * @see realtimeSophia.ts
 */

export type VoiceRealtimeTransport = 'twilio_gather' | 'xai_realtime_ws';

export function isVoiceRealtimePremiumEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = env.VOICE_REALTIME_PREMIUM?.trim().toLowerCase() ?? '';
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function getVoiceRealtimeStatus(env: NodeJS.ProcessEnv = process.env): {
  productionDefault: VoiceRealtimeTransport;
  premiumEnabled: boolean;
  premiumTransport: VoiceRealtimeTransport;
  workerdCompatible: boolean;
  message: string;
} {
  const premiumEnabled = isVoiceRealtimePremiumEnabled(env);
  return {
    productionDefault: 'twilio_gather',
    premiumEnabled,
    premiumTransport: 'xai_realtime_ws',
    // Bidirectional WS audio is not the CF Workers Gather path
    workerdCompatible: false,
    message: premiumEnabled
      ? 'Premium xAI realtime WS is flagged on — use a Node sidecar or supported host (not Workerd Gather).'
      : 'Using Twilio Gather + Grok tools (recommended for Cloudflare Workers). Set VOICE_REALTIME_PREMIUM=true only with a sidecar host.',
  };
}
