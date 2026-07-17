import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { encryptJsonObject } from '@/lib/encryption';
import { rlsContextFromSession, rlsTransaction } from '@/lib/apex/rlsContext';
import { apiError, NOT_FOUND_ERROR, reportMappedRouteError } from '@/lib/errors';
import { scoreWarrantyStory } from '@/lib/grok';
import { broadcastCompanionEvent } from '@/lib/companionBroadcast';
import { isStoryQualityParseFailure } from '@/prompts/storyQuality';
import type { StoryQualityResult } from '@/types';
import { scopedRepairLineWhereForSession } from '@/lib/repairOrderAccess';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { mapGrokRouteError } from '@/lib/grokErrors';
import { PROMPT_VERSION } from '@/prompts/version';
import { hashWarrantyStory } from '@/lib/storyHash';
import { logStoryTechnicianActivity } from '@/lib/storyTechnicianLog';
import { auditDealerIdFromSession } from '@/lib/audit';
import { persistRepairLineStoryInTransaction } from '@/lib/storyAiPersist';
import { withStoryAiRoute } from '@/lib/storyAiRoute';
import { parseRequestBody, reviewStorySchema } from '@/lib/validation';

/** Must match STORY_SCORE_ROUTE_MAX_DURATION_S in @/lib/timeouts */
export const maxDuration = 100;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  return withStoryAiRoute(
    request,
    params,
    {
      rateLimitKey: 'story.score',
      rateLimit: RATE_LIMITS.generate,
      trackUsage: true,
      blockInMaintenance: true,
      perfEvent: 'route.story.score',
      customerPayMessage: 'Customer Pay stories do not require AI quality scoring.',
    },
    async ({ request: req, session, repairOrderId: id, lineId, mapped, line, storyPack }) => {
      const parsed = await parseRequestBody(req, reviewStorySchema);
      if ('error' in parsed) return parsed.error;

      const warrantyStory = parsed.data.warrantyStory.trim();
      if (!warrantyStory) {
        return apiError('Warranty story text is required for scoring.', 400);
      }

      // Prefer client notes snapshot so CORRECTIONS_ALREADY_APPLIED + score reconcile
      // still work when RO PUT is slightly behind Add Tech Details.
      const clientNotes =
        typeof parsed.data.technicianNotes === 'string' && parsed.data.technicianNotes.trim()
          ? parsed.data.technicianNotes
          : undefined;
      const lineForScore = clientNotes ? { ...line, technicianNotes: clientNotes } : line;
      const mappedForScore = clientNotes
        ? {
            ...mapped,
            repairLines: mapped.repairLines.map((l) => (l.id === lineId ? lineForScore : l)),
          }
        : mapped;

      let quality: StoryQualityResult;
      try {
        const scored = await scoreWarrantyStory(mappedForScore, lineForScore, warrantyStory, {
          pack: storyPack,
        });
        quality = { ...scored, scoredAgainstStory: warrantyStory };
        if (isStoryQualityParseFailure(quality)) {
          logger.error('story.score.parse_failed', {
            repairOrderId: id,
            lineId,
            technicianId: session.technicianId,
            summary: quality.summary,
          });
          return apiError(
            `Story audit could not read the AI score. ${quality.summary} Tap Audit Story to try again.`,
            502
          );
        }
      } catch (error) {
        const mappedError = mapGrokRouteError(error, 'Story scoring');
        if (error instanceof Error && error.message.includes('unreadable JSON')) {
          return reportMappedRouteError(
            {
              message:
                'Story audit could not read the AI score. AI quality score returned unreadable JSON.',
              status: 502,
              logDetail: mappedError.logDetail,
            },
            error,
            'story.score'
          );
        }
        return reportMappedRouteError(mappedError, error, 'story.score');
      }

      const storyHash = hashWarrantyStory(warrantyStory);

      try {
        await rlsTransaction(
          async (tx) => {
            await persistRepairLineStoryInTransaction(
              tx,
              {
                action: 'story.score',
                dealershipId: session.dealershipId,
                dealerId: auditDealerIdFromSession(session),
                technicianId: session.technicianId,
                entityType: 'repairLine',
                entityId: lineId,
                promptVersion: PROMPT_VERSION,
                metadata: {
                  repairOrderId: id,
                  lineNumber: line.lineNumber,
                  promptVersion: PROMPT_VERSION,
                  qualityScore: quality.score,
                  qualityGrade: quality.grade,
                  storyHash,
                },
                ipAddress: getRequestIp(req),
              },
              {
                where: scopedRepairLineWhereForSession(lineId, id, session),
                data: {
                  storyQualityAuditEncrypted: encryptJsonObject(quality),
                  // APEX NATIONAL PLATFORM — stamp dealerId from authenticated session when present.
                  ...dealerIdWriteFields(resolveDealerIdForWrite({ session })),
                },
              }
            );
          },
          { ...rlsContextFromSession(session), enforced: true }
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'Repair line not found for story persist') {
          return apiError(NOT_FOUND_ERROR, 404);
        }
        throw error;
      }

      void logStoryTechnicianActivity({
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        event: 'story.score',
        message: `Scored warranty story for RO ${mapped.roNumber}, line ${line.lineNumber}`,
        repairOrderId: id,
        repairLineId: lineId,
        roNumber: mapped.roNumber,
        lineNumber: line.lineNumber,
        metadata: {
          qualityScore: quality.score,
          qualityGrade: quality.grade,
          storyHash,
          promptVersion: PROMPT_VERSION,
        },
      });

      void broadcastCompanionEvent(session.technicianId, {
        type: 'story.quality',
        repairOrderId: id,
        lineId,
        quality,
      });
      void broadcastCompanionEvent(session.technicianId, {
        type: 'activity',
        label: `Audit complete (score: ${quality.score})`,
        repairOrderId: id,
        lineId,
      });

      return { quality };
    }
  );
}