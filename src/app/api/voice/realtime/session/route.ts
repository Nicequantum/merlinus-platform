import { withAuth } from '@/lib/apiRoute';
import { getVoiceRealtimeStatus, isVoiceRealtimePremiumEnabled } from '@/lib/voiceAgent/realtimeConfig';

export const dynamic = 'force-dynamic';

/**
 * P3-2 — Premium realtime voice session handshake (scaffold).
 *
 * Production path remains Twilio Gather. When VOICE_REALTIME_PREMIUM is off,
 * returns 501 with guidance. When on, returns config for a Node sidecar host
 * (not a full Workerd WebSocket media bridge).
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const status = getVoiceRealtimeStatus();
      if (!isVoiceRealtimePremiumEnabled()) {
        return Response.json(
          {
            error:
              'Realtime WebSocket voice is not enabled. Production uses Twilio Gather + Grok tools.',
            code: 'VOICE_REALTIME_DISABLED',
            status,
          },
          { status: 501 }
        );
      }

      return {
        ok: true,
        mode: 'premium_scaffold',
        dealershipId: session.dealershipId,
        status,
        instructions: [
          'Run a Node sidecar that opens createReceptionistAgent() from @/lib/voiceAgent/realtimeSophia',
          'Do not rely on Cloudflare Workerd for bidirectional media WebSockets in this release',
          'Bridge Twilio Media Streams to the sidecar if you need full duplex audio',
        ],
        // No ephemeral xAI session token yet — host uses GROK_API_KEY server-side only
        sessionToken: null,
      };
    },
    {
      rateLimitKey: 'voice.realtime.session',
      requireDealershipContext: true,
      requireModule: 'voice_agent',
    }
  );
}

export async function GET(request: Request) {
  return withAuth(
    request,
    async () => ({ status: getVoiceRealtimeStatus() }),
    {
      rateLimitKey: 'voice.realtime.status',
      requireDealershipContext: true,
      requireModule: 'voice_agent',
    }
  );
}
