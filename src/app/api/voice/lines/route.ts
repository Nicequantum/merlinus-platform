import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { normalizeToE164 } from '@/lib/voiceAgent/twilio';
import { z } from 'zod';

/**
 * PR-M5a — manager: list / create voice agent lines for the rooftop.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const lines = await getRlsDb().voiceAgentLine.findMany({
        where: { dealershipId: session.dealershipId },
        orderBy: { createdAt: 'desc' },
      });
      return {
        lines: lines.map((l) => ({
          id: l.id,
          e164Number: l.e164Number,
          label: l.label,
          provider: l.provider,
          isActive: l.isActive,
          createdAt: l.createdAt.toISOString(),
        })),
      };
    },
    {
      rateLimitKey: 'voice.lines.list',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'voice_agent',
    }
  );
}

const createSchema = z.object({
  e164Number: z.string().trim().min(8).max(20),
  label: z.string().trim().max(80).optional(),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, createSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const e164 = normalizeToE164(parsed.data.e164Number);
      const existing = await getRlsDb().voiceAgentLine.findFirst({
        where: { e164Number: e164 },
      });
      if (existing) {
        return apiError('That phone number is already registered', 409);
      }

      const line = await getRlsDb().voiceAgentLine.create({
        data: {
          dealershipId: session.dealershipId,
          e164Number: e164,
          label: parsed.data.label?.trim() || 'Main',
          provider: 'twilio',
          isActive: true,
        },
      });

      return {
        line: {
          id: line.id,
          e164Number: line.e164Number,
          label: line.label,
          provider: line.provider,
          isActive: line.isActive,
          createdAt: line.createdAt.toISOString(),
        },
      };
    },
    {
      rateLimitKey: 'voice.lines.create',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'voice_agent',
    }
  );
}
