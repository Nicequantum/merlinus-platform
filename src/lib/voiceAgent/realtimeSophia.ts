/**
 * Advanced xAI Realtime WebSocket session for Sophia.
 *
 * Primary production path on Cloudflare is Twilio <Gather> + Grok chat tools
 * (see /api/voice/inbound and processAgentTurn). This module is the cutting-edge
 * bidirectional audio path for Media Streams sidecars, local demos, or a
 * long-lived Node worker (not Workerd).
 *
 * npm install ws  (Node sidecar only)
 *
 * Environment:
 *   GROK_API_KEY_2 (preferred voice slot), else GROK_API_KEY, else XAI_API_KEY
 *   Optional: GROK_REALTIME_URL (default wss://api.x.ai/v1/realtime)
 */

import { getGrokVoiceApiKey } from '@/lib/grokApiKey.shared';
import type { DealershipContext } from '@/lib/voiceAgent/dealershipContext';
import {
  STAGING_MERCEDES_BENZ_CONTEXT,
  buildSophiaWelcome,
  formatDealershipContextBlock,
} from '@/lib/voiceAgent/dealershipContext';
import { buildSophiaSystemPrompt } from '@/lib/voiceAgent/sophiaPrompt';

export type RealtimeSophiaHandlers = {
  onOpen?: () => void;
  onSpeech?: (text: string) => void;
  onError?: (error: Error) => void;
  onClose?: (code: number, reason: string) => void;
  onEvent?: (event: Record<string, unknown>) => void;
};

export type RealtimeSophiaSession = {
  /** Send a user transcript turn (text mode / hybrid) */
  sendUserText: (text: string) => void;
  /** Append base64 PCM/mulaw audio if the session is in audio mode */
  sendAudioChunk: (base64Audio: string) => void;
  /** Commit audio buffer and request a response */
  commitAudio: () => void;
  /** Graceful shutdown */
  close: () => void;
  /** Dealership context bound to this session */
  context: DealershipContext;
};

function resolveApiKey(): string {
  // Voice slot: GROK_API_KEY_2 → GROK_API_KEY → XAI_API_KEY
  return getGrokVoiceApiKey();
}

function buildInstructions(ctx: DealershipContext): string {
  return `${buildSophiaSystemPrompt('receptionist', ctx)}

## Realtime mode notes
- Respond in natural spoken English only.
- Keep turns short for low latency.
- When you would create staff work, say you will note it for the team (tool bridge may be layered by the host).

[DEALERSHIP_CONTEXT]
${formatDealershipContextBlock(ctx)}`;
}

/**
 * Create a Sophia realtime WebSocket session against xAI.
 * Uses global WebSocket when available (browsers / modern Node 22+).
 * For older Node, host with: import WebSocket from 'ws' and pass via options.WebSocketImpl.
 */
export function createReceptionistAgent(
  dealershipContext: DealershipContext = STAGING_MERCEDES_BENZ_CONTEXT,
  handlers: RealtimeSophiaHandlers = {},
  options?: {
    WebSocketImpl?: typeof WebSocket;
    model?: string;
    voice?: string;
  }
): RealtimeSophiaSession {
  const WS = options?.WebSocketImpl || (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WS) {
    throw new Error(
      'WebSocket is not available. Use Node 22+ or pass WebSocketImpl from the "ws" package.'
    );
  }

  const apiKey = resolveApiKey();
  const url =
    process.env.GROK_REALTIME_URL?.trim() ||
    process.env.XAI_REALTIME_URL?.trim() ||
    'wss://api.x.ai/v1/realtime';

  const model =
    options?.model ||
    process.env.GROK_REALTIME_MODEL?.trim() ||
    process.env.GROK_VOICE_MODEL?.trim() ||
    'grok-2-public';

  // Browser WebSocket cannot set Authorization headers — use query when needed
  const wsUrl = url.includes('?')
    ? `${url}&model=${encodeURIComponent(model)}`
    : `${url}?model=${encodeURIComponent(model)}`;

  let ws: WebSocket;
  try {
    // Node `ws` accepts headers as a second argument; browser ignores unknown opts
    ws = new (WS as unknown as new (
      url: string,
      protocols?: string | string[],
      options?: { headers?: Record<string, string> }
    ) => WebSocket)(wsUrl, undefined, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    ws = new WS(wsUrl);
  }

  let closed = false;
  const send = (payload: Record<string, unknown>) => {
    if (closed || ws.readyState !== WS.OPEN) return;
    ws.send(JSON.stringify(payload));
  };

  ws.addEventListener('open', () => {
    // Session bootstrap (shape aligned with OpenAI/xAI realtime-style events)
    send({
      type: 'session.update',
      session: {
        instructions: buildInstructions(dealershipContext),
        voice: options?.voice || process.env.GROK_REALTIME_VOICE || 'alloy',
        turn_detection: { type: 'server_vad' },
        input_audio_transcription: { model: 'whisper-1' },
        modalities: ['text', 'audio'],
      },
    });
    // Warm open with welcome text so the agent can speak first if host requests
    send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'input_text', text: buildSophiaWelcome(dealershipContext) }],
      },
    });
    handlers.onOpen?.();
  });

  ws.addEventListener('message', (ev) => {
    try {
      const data =
        typeof ev.data === 'string'
          ? (JSON.parse(ev.data) as Record<string, unknown>)
          : null;
      if (!data) return;
      handlers.onEvent?.(data);
      const type = String(data.type || '');
      if (type === 'error') {
        handlers.onError?.(new Error(JSON.stringify(data.error || data)));
        return;
      }
      // Best-effort extract assistant text deltas
      const delta =
        (data.delta as string) ||
        ((data.transcript as string) ||
          (data.text as string) ||
          '');
      if (type.includes('transcript') || type.includes('text') || type.includes('audio_transcript')) {
        if (delta) handlers.onSpeech?.(delta);
      }
      const item = data.item as { content?: Array<{ transcript?: string; text?: string }> } | undefined;
      if (type === 'response.done' || type === 'response.output_item.done') {
        const t =
          item?.content?.map((c) => c.transcript || c.text || '').join(' ').trim() || '';
        if (t) handlers.onSpeech?.(t);
      }
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });

  ws.addEventListener('error', () => {
    handlers.onError?.(new Error('Sophia realtime WebSocket error'));
  });

  ws.addEventListener('close', (ev) => {
    closed = true;
    handlers.onClose?.(ev.code, ev.reason || '');
  });

  return {
    context: dealershipContext,
    sendUserText(text: string) {
      send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      });
      send({ type: 'response.create' });
    },
    sendAudioChunk(base64Audio: string) {
      send({ type: 'input_audio_buffer.append', audio: base64Audio });
    },
    commitAudio() {
      send({ type: 'input_audio_buffer.commit' });
      send({ type: 'response.create' });
    },
    close() {
      closed = true;
      try {
        ws.close(1000, 'client_close');
      } catch {
        // ignore
      }
    },
  };
}

/** Staging helper — Mercedes-Benz Staging DID +1 (401) 645-4563 */
export function createStagingSophiaAgent(handlers?: RealtimeSophiaHandlers): RealtimeSophiaSession {
  return createReceptionistAgent(STAGING_MERCEDES_BENZ_CONTEXT, handlers);
}
