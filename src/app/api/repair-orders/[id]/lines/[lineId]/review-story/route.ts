import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { encryptJsonObject } from '@/lib/encryption';
import { rlsContextFromSession, rlsTransaction } from '@/lib/apex/rlsContext';
import { apiError, NOT_FOUND_ERROR, reportMappedRouteError } from '@/lib/errors';
import { reviewWarrantyStory } from '@/lib/grok';
import { PROMPT_VERSION } from '@/prompts/version';
import { scopedRepairLineWhereForSession } from '@/lib/repairOrderAccess';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { mapGrokRouteError } from '@/lib/grokErrors';
import { logger } from '@/lib/logger';
import { hashWarrantyStory } from '@/lib/storyHash';
import { logStoryTechnicianActivity } from '@/lib/storyTechnicianLog';
import { auditDealerIdFromSession } from '@/lib/audit';
import { persistRepairLineStoryInTransaction } from '@/lib/storyAiPersist';
import { withStoryAiRoute } from '@/lib/storyAiRoute';
import { parseRequestBody, reviewStorySchema } from '@/lib/validation';

/** Must match STORY_REVIEW_ROUTE_MAX_DURATION_S in @/lib/timeouts */
export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  return withStoryAiRoute(
    request,
    params,
    {
      rateLimitKey: 'story.review',
      rateLimit: RATE_LIMITS.generate,
      trackUsage: true,
      blockInMaintenance: true,
      perfEvent: 'route.story.review',
      customerPayMessage:
        'Customer Pay stories do not require AI quality review. Edit the text directly if needed.',
    },
    async ({ request: req, session, repairOrderId: id, lineId, mapped, line, storyPack }) => {
      const parsed = await parseRequestBody(req, reviewStorySchema);
      if ('error' in parsed) return parsed.error;

      const warrantyStory = parsed.data.warrantyStory.trim();
      if (!warrantyStory) {
        return apiError('Warranty story text is required for review.', 400);
      }

      let review;
      try {
        review = await reviewWarrantyStory(mapped, line, warrantyStory, { pack: storyPack });
        if (review.parseFailed) {
          logger.error('story.review.parse_failed', {
            repairOrderId: id,
            lineId,
            technicianId: session.technicianId,
            summary: review.summary,
          });
          return apiError(
            `Story review could not read the AI score. ${review.summary} Tap Review with AI to try again.`,
            502
          );
        }
      } catch (error) {
        const mappedErr = mapGrokRouteError(error, 'Story review');
        return reportMappedRouteError(mappedErr, error, 'story.review');
      }

      const quality = { ...review, scoredAgainstStory: warrantyStory };
      const storyHash = hashWarrantyStory(warrantyStory);

      try {
        await rlsTransaction(
          async (tx) => {
            await persistRepairLineStoryInTransaction(
              tx,
              {
                action: 'story.review',
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
                  reviewMode: 'coaching',
                },
                ipAddress: getRequestIp(req),
              },
              {
                where: scopedRepairLineWhereForSession(lineId, id, session),
                data: {
                  storyQualityAuditEncrypted: encryptJsonObject(quality),
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
        event: 'story.review',
        message: `Reviewed warranty story for RO ${mapped.roNumber}, line ${line.lineNumber}`,
        repairOrderId: id,
        repairLineId: lineId,
        roNumber: mapped.roNumber,
        lineNumber: line.lineNumber,
        metadata: {
          qualityScore: quality.score,
          qualityGrade: quality.grade,
          storyHash,
          reviewMode: 'coaching',
          promptVersion: PROMPT_VERSION,
        },
      });

      return { review: quality };
    }
  );
}
