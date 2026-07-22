/**
 * POST /api/voice/[department]/query
 * Department Sophia assistant for tablet / front-desk (SSE stream preferred).
 *
 * Body: { message, conversationId?, handoffBrief?, stream?: boolean }
 * Departments: service | parts | sales | loaner
 */
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import type { VoiceDepartmentId } from '@/lib/modules/catalog';
import { ModuleDisabledError } from '@/lib/modules/entitlements';
import { RATE_LIMITS } from '@/lib/rate-limit';
import {
  runDepartmentQuery,
  runDepartmentQueryOnce,
} from '@/lib/voiceAgent/departmentQuery';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const paramsSchema = z.object({
  department: z.enum(['service', 'parts', 'sales', 'loaner']),
});

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().trim().min(1).max(64).optional().nullable(),
  handoffBrief: z.string().trim().max(500).optional().nullable(),
  /** Default true — SSE event stream */
  stream: z.boolean().optional().default(true),
  /** Manager "Test this customization" draft (not persisted) */
  previewTailoring: z
    .object({
      customInstructions: z.string().max(8000).optional(),
      greeting: z.string().max(4000).optional(),
      disclaimers: z.string().max(4000).optional(),
      toneGuidelines: z.string().max(4000).optional(),
    })
    .optional()
    .nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ department: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const department = routeParams.data.department as VoiceDepartmentId;

  const url = new URL(request.url);
  const wantStream =
    url.searchParams.get('stream') !== '0' &&
    (request.headers.get('accept') || '').includes('text/event-stream');

  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const stream = parsed.data.stream !== false || wantStream;

      try {
        const input = {
          dealershipId: session.dealershipId,
          technicianId: session.technicianId,
          department,
          message: parsed.data.message,
          conversationId: parsed.data.conversationId,
          dealershipName: session.dealershipName,
          handoffBrief: parsed.data.handoffBrief,
          managerName: session.name,
          previewTailoring: parsed.data.previewTailoring,
        };

        if (!stream) {
          const result = await runDepartmentQueryOnce(input);
          return {
            ok: true,
            department,
            ...result,
          };
        }

        const encoder = new TextEncoder();
        const readable = new ReadableStream<Uint8Array>({
          async start(controller) {
            const push = (payload: unknown) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            };
            try {
              for await (const event of runDepartmentQuery(input)) {
                push(event);
              }
            } catch (error) {
              push({
                type: 'status',
                phase: 'error',
                message: error instanceof Error ? error.message : 'Voice query failed',
              });
            } finally {
              try {
                controller.close();
              } catch {
                // closed
              }
            }
          },
        });

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      } catch (error) {
        if (error instanceof ModuleDisabledError) {
          return apiError(error.message, 403);
        }
        throw error;
      }
    },
    {
      rateLimitKey: `voice.dept.${department}`,
      rateLimit: RATE_LIMITS.generate,
      requireDealershipContext: true,
      trackUsage: true,
    }
  );
}
