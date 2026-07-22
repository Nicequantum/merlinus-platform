import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { rlsContextFromSession, rlsTransaction } from '@/lib/apex/rlsContext';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { generateWarrantyStory } from '@/lib/grok';
import { buildStoryGenerateAuditMetadata } from '@/lib/promptFingerprint';
import { encryptOptionalSensitiveText } from '@/lib/encryption';
import { scopedRepairLineWhereForSession } from '@/lib/repairOrderAccess';
import { apiError, NOT_FOUND_ERROR, reportMappedRouteError } from '@/lib/errors';
import { mapGrokRouteError } from '@/lib/grokErrors';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';
import { logPerformance } from '@/lib/perf';
import { auditStoryGenerationPipeline } from '@/lib/storyGenerationPipeline';
import { broadcastCompanionEvent } from '@/lib/companionBroadcast';
import { logStoryTechnicianActivity } from '@/lib/storyTechnicianLog';
import { CLEAR_STORY_CERTIFICATION_DB } from '@/lib/storyCertification';
import { auditDealerIdFromSession } from '@/lib/audit';
import { persistRepairLineStoryInTransaction } from '@/lib/storyAiPersist';
import { recordFirstStoryGeneratedUsage } from '@/lib/storyUsageBilling';
import { withStoryAiRoute } from '@/lib/storyAiRoute';
import { logger } from '@/lib/logger';
import {
  enqueueStoryGenerationJob,
  isAiJobsQueueConfigured,
} from '@/lib/queue/aiJobs';

// M4/M5 — customer-pay guard enforced in withStoryAiRoute (isCustomerPayRepairLine).
void isCustomerPayRepairLine;

/** Must match STORY_GENERATE_ROUTE_MAX_DURATION_S in @/lib/timeouts */
export const maxDuration = 90;

/**
 * Prefer durable async (CF Queue) when AI_JOBS_QUEUE is bound.
 * Dev without queue: sync path (or async+inline when body.async=true).
 * Force sync: body.sync=true or AI_STORY_FORCE_SYNC=1
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  // Phase 7.3 H14 — shared shell (blockServiceAdvisorAi + load + customer-pay guard)
  return withStoryAiRoute(
    request,
    params,
    {
      rateLimitKey: 'story.generate',
      rateLimit: RATE_LIMITS.generate,
      trackUsage: true,
      blockInMaintenance: true,
      perfEvent: 'route.story.generate',
      customerPayMessage:
        'This line uses a Customer Pay template. Clear Customer Pay mode (Switch to warranty AI) to generate with Grok.',
    },
    async ({ request: req, session, repairOrderId: id, lineId, mapped, line, storyBrand, storyPack }) => {
      // Client may send latest notes + story so regenerate never races a lagging PUT.
      let clientNotes: string | undefined;
      let clientStory: string | undefined;
      let forceSync = process.env.AI_STORY_FORCE_SYNC === '1' || process.env.AI_STORY_FORCE_SYNC === 'true';
      let wantAsync = false;
      try {
        const body = (await req.json().catch(() => null)) as {
          technicianNotes?: unknown;
          warrantyStory?: unknown;
          async?: unknown;
          sync?: unknown;
        } | null;
        if (typeof body?.technicianNotes === 'string' && body.technicianNotes.trim()) {
          clientNotes = body.technicianNotes;
        }
        if (typeof body?.warrantyStory === 'string' && body.warrantyStory.trim()) {
          clientStory = body.warrantyStory;
        }
        if (body?.sync === true || body?.sync === '1') forceSync = true;
        if (body?.async === true || body?.async === '1') wantAsync = true;
      } catch {
        // empty body is fine
      }

      const queueReady = isAiJobsQueueConfigured();
      // Production with queue → async by default; dev without queue → sync unless async requested
      const useDurableAsync =
        !forceSync && (queueReady || wantAsync || process.env.NODE_ENV === 'production');

      if (useDurableAsync) {
        const enqueued = await enqueueStoryGenerationJob({
          dealershipId: session.dealershipId,
          userId: session.technicianId,
          roId: id,
          lineId,
          technicianNotes: clientNotes,
          warrantyStory: clientStory,
          preferredLanguage: session.preferredLanguage ?? 'en',
          allowInlineFallback: !queueReady || wantAsync,
        });
        return {
          async: true as const,
          jobId: enqueued.jobId,
          status: enqueued.status,
          transport: enqueued.transport,
          phase: 'queued' as const,
          pollUrl: `/api/queue/job-status/${enqueued.jobId}`,
          message:
            enqueued.transport === 'queue'
              ? 'Story generation queued. Poll pollUrl until phase is complete.'
              : 'Story generation started (inline worker). Poll pollUrl until phase is complete.',
        };
      }

      const lineForGen = {
        ...line,
        ...(clientNotes !== undefined ? { technicianNotes: clientNotes } : {}),
        ...(clientStory !== undefined ? { warrantyStory: clientStory } : {}),
      };
      const mappedForGen = {
        ...mapped,
        repairLines: mapped.repairLines.map((l) => (l.id === lineId ? lineForGen : l)),
      };

      // Never let pipeline audit crash the route (was a source of bare "Request failed").
      let pipelineAudit: ReturnType<typeof auditStoryGenerationPipeline>;
      try {
        pipelineAudit = auditStoryGenerationPipeline(mappedForGen, lineForGen, { brand: storyBrand });
        logPerformance('story.generate.pipeline', 0, { ...pipelineAudit });
      } catch (pipelineError) {
        logger.warn('story.generate.pipeline_audit_failed', {
          error: pipelineError instanceof Error ? pipelineError.message : 'unknown',
        });
        pipelineAudit = {
          model: 'unknown',
          reasoningEffort: 'n/a',
          systemPromptChars: 0,
          userMessageChars: 0,
          totalPromptChars: 0,
          maxOutputTokens: 4096,
          preGrokDbOps: [],
          excludedFromPrompt: [],
          timeouts: { grokMs: 0, routeMaxDurationS: 90, clientMs: 0 },
        };
      }

      let warrantyStory: string;
      let cdkSanitized = false;
      try {
        const grokStartedAt = Date.now();
        const rawStory = await generateWarrantyStory(mappedForGen, lineForGen, {
          pack: storyPack,
          // Server session is source of truth (UI language preference).
          preferredLanguage: session.preferredLanguage ?? 'en',
        });
        logPerformance('grok.story.generate.route', Date.now() - grokStartedAt, {
          model: pipelineAudit.model,
          promptChars: pipelineAudit.totalPromptChars,
          storyBrand,
          isRevision: Boolean(
            lineForGen.warrantyStory?.trim() && lineForGen.warrantyStory.trim().length >= 40
          ),
          clientSnapshot: Boolean(clientNotes || clientStory),
        });
        const cleaned = sanitizeForCDKWithMeta(rawStory);
        warrantyStory = cleaned.text;
        cdkSanitized = cleaned.wasModified;
      } catch (error) {
        logger.error('story.generate.failed', {
          error: error instanceof Error ? error.message : 'unknown',
          repairOrderId: id,
          lineId,
        });
        const mappedErr = mapGrokRouteError(error, 'Story generation');
        return reportMappedRouteError(mappedErr, error, 'story.generate');
      }

      try {
        const lineWhere = scopedRepairLineWhereForSession(lineId, id, session);
        const dealerId = resolveDealerIdForWrite({ session });
        await rlsTransaction(
          async (tx) => {
            // 1) Persist generated story (audit + line update) — existing path.
            await persistRepairLineStoryInTransaction(
              tx,
              {
                action: 'story.generate',
                dealershipId: session.dealershipId,
                dealerId: auditDealerIdFromSession(session),
                technicianId: session.technicianId,
                entityType: 'repairLine',
                entityId: lineId,
                metadata: buildStoryGenerateAuditMetadata({
                  repairOrderId: id,
                  lineNumber: line.lineNumber,
                  advisorIntelligenceUsed: false,
                  advisorContextHash: null,
                  knowledgeBaseEntryIds: [],
                  historyContextLineCount: 0,
                  qualityScore: null,
                  qualityGrade: null,
                  serviceAdvisorId: null,
                  storyBrand,
                  packVersion: storyPack.packVersion,
                }),
                ipAddress: getRequestIp(req),
              },
              {
                where: lineWhere,
                data: {
                  warrantyStoryEncrypted: encryptOptionalSensitiveText(warrantyStory),
                  storyQualityAuditEncrypted: '',
                  ...CLEAR_STORY_CERTIFICATION_DB,
                  ...dealerIdWriteFields(dealerId),
                },
              }
            );

            // 2) Billing meter: first successful AI story only (same transaction).
            // Regenerations no-op when story_generated is already true.
            if (warrantyStory.trim().length > 0) {
              await recordFirstStoryGeneratedUsage(tx, {
                dealershipId: session.dealershipId,
                dealerId,
                repairOrderId: id,
                repairLineId: lineId,
                lineWhere,
              });
            }
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
        event: 'story.generate',
        message: `Generated warranty story for RO ${mapped.roNumber}, line ${line.lineNumber}`,
        repairOrderId: id,
        repairLineId: lineId,
        roNumber: mapped.roNumber,
        lineNumber: line.lineNumber,
        metadata: {
          cdkSanitized,
          model: pipelineAudit.model,
          promptChars: pipelineAudit.totalPromptChars,
        },
      });

      void broadcastCompanionEvent(session.technicianId, {
        type: 'ro.patch',
        repairOrderId: id,
        lineId,
        linePatch: { warrantyStory },
      });
      void broadcastCompanionEvent(session.technicianId, {
        type: 'activity',
        label: 'Generated warranty story',
        repairOrderId: id,
        lineId,
      });

      return { warrantyStory, quality: null, cdkSanitized };
    }
  );
}
