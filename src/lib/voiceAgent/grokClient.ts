/**
 * PR-M5a — Grok chat with tool calling for voice agents (isolated from story pipeline).
 */

import 'server-only';

import { getGrokApiKey } from '@/lib/grokApiKey.shared';
import { GROK_CHAT_MODEL } from '@/lib/grokModels';
import { logger } from '@/lib/logger';

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

export type VoiceChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: VoiceToolCall[];
};

export type VoiceToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type VoiceChatResult = {
  content: string;
  toolCalls: VoiceToolCall[];
};

export async function grokVoiceChat(input: {
  messages: VoiceChatMessage[];
  tools: unknown[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<VoiceChatResult> {
  if (typeof window !== 'undefined') {
    throw new Error('grokVoiceChat is server-only');
  }

  const timeoutMs = input.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getGrokApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROK_VOICE_MODEL?.trim() || GROK_CHAT_MODEL,
        messages: input.messages,
        tools: input.tools,
        tool_choice: 'auto',
        temperature: input.temperature ?? 0.4,
        max_tokens: input.maxTokens ?? 500,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.warn('voice.grok_error', { status: response.status, bodyLength: errBody.length });
      throw new Error(`Grok voice API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };

    const message = data.choices?.[0]?.message;
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    const toolCalls: VoiceToolCall[] = (message?.tool_calls || [])
      .filter((tc) => tc.function?.name)
      .map((tc) => ({
        id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
        type: 'function' as const,
        function: {
          name: tc.function!.name!,
          arguments: tc.function?.arguments || '{}',
        },
      }));

    return { content, toolCalls };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Grok voice timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
