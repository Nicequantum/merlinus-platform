/**
 * Durable queue handler — warranty story generation (Grok).
 * Extracted from generate-story route for reuse by consumer + inline fallback.
 */
import 'server-only';

import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import {
  getRlsDb,
  rlsContextFromSession,
  rlsTransaction,
  withSessionRls,
} from '@/lib/apex/rlsContext';
import { auditDealerIdFromSession } from '@/lib/audit';
import { markAiJobProgress } from '@/lib/aiJobs/service';
import { broadcastCompanionEvent } from '@/lib/companionBroadcast';
import { encryptOptionalSensitiveText } from '@/lib/encryption';
import { generateWarrantyStory } from '@/lib/grok';
import { logger } from '@/lib/logger';
import { logPerformance } from '@/lib/perf';
import { buildStoryGenerateAuditMetadata } from '@/lib/promptFingerprint';
import type { AiQueueMessage } from '@/lib/queue/types';
import { loadStoryRouteRepairOrder } from '@/lib/repairOrderAccess';
import { scopedRepairLineWhereForSession } from '@/lib/repairOrderAccess';
import { dbToRepairOrder } from '@/lib/roMapper';
import { sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';
import { persistRepairLineStoryInTransaction } from '@/lib/storyAiPersist';
import { CLEAR_STORY_CERTIFICATION_DB } from '@/lib/storyCertification';
import { storyBrandFromDealership } from '@/lib/storyBrand/resolveStoryBrand';
import { auditStoryGenerationPipeline } from '@/lib/storyGenerationPipeline';
import { recordFirstStoryGeneratedUsage } from '@/lib/storyUsageBilling';
import { logStoryTechnicianActivity } from '@/lib/storyTechnicianLog';
import { resolveStoryBrandPack } from '@/prompts/story';
import type { SessionPayload } from '@/lib/auth';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';

function sessionFromMessage(msg: AiQueueMessage): SessionPayload {
  // Minimal session for RLS + audit — queue jobs are trusted after producer auth.
  return {
    technicianId: msg.userId,
    d7Number: null,
    name: 'AI Job',
    role: 'technician',
    isAdmin: false,
    dealershipId: msg.dealershipId,
    dealershipName: '',
    serviceAdvisorId: null,
    consentAt: new Date().toISOString(),
    consentVersion: 'queue',
    legalDisclaimerAt: new Date().toISOString(),
    legalDisclaimerVersion: 'queue',
    sessionVersion: 0,
    preferredLanguage:
      typeof msg.payload.preferredLanguage === 'string'
        ? msg.payload.preferredLanguage
        : 'en',
    scopeMode: 'dealership',
    activeDealershipId: msg.dealershipId,
  };
}

export interface StoryGenerationJobResult {
  warrantyStory: string;
  cdkSanitized: boolean;
  quality: null;
  repairOrderId: string;
  lineId: string;
}

/**
 * Run story generation for a durable queue message.
 * Must be called inside processAiQueueMessage (status already running).
 */
export async function handleStoryGenerationJob(
  msg: AiQueueMessage
): Promise<StoryGenerationJobResult> {
  const roId = msg.roId?.trim() || '';
  const lineId = msg.lineId?.trim() || '';
  if (!roId || !lineId) {
    throw new Error('story.generate requires roId and lineId');
  }

  const session = sessionFromMessage(msg);
  const clientNotes =
    typeof msg.payload.technicianNotes === 'string' ? msg.payload.technicianNotes : undefined;
  const clientStory =
    typeof msg.payload.warrantyStory === 'string' ? msg.payload.warrantyStory : undefined;

  return withSessionRls(session, async () => {
    await markAiJobProgress(msg.jobId, 20);

    const ro = await loadStoryRouteRepairOrder(session, roId);
    if (!ro) throw new Error('Repair order not found');

    const mapped = dbToRepairOrder(ro);
    const line = mapped.repairLines.find((l) => l.id === lineId);
    if (!line) throw new Error('Repair line not found');

    const dbLine = ro.repairLines.find((l) => l.id === lineId);
    if (!dbLine) throw new Error('Repair line not found');
    if (isCustomerPayRepairLine(dbLine)) {
      throw new Error(
        'This line uses a Customer Pay template. Clear Customer Pay mode to use warranty AI.'
      );
    }

    let storyBrand = storyBrandFromDealership(null);
    try {
      const dealership = await getRlsDb().dealership.findFirst({
        where: { id: session.dealershipId },
        select: { storyBrand: true, name: true },
      });
      storyBrand = storyBrandFromDealership(dealership);
      if (dealership?.name) {
        session.dealershipName = dealership.name;
      }
    } catch {
      storyBrand = storyBrandFromDealership(null);
    }
    const storyPack = resolveStoryBrandPack(storyBrand, { preferDefaultMercedes: true });

    const lineForGen = {
      ...line,
      ...(clientNotes !== undefined ? { technicianNotes: clientNotes } : {}),
      ...(clientStory !== undefined ? { warrantyStory: clientStory } : {}),
    };
    const mappedForGen = {
      ...mapped,
      repairLines: mapped.repairLines.map((l) => (l.id === lineId ? lineForGen : l)),
    };

    await markAiJobProgress(msg.jobId, 35);

    let pipelineAudit: ReturnType<typeof auditStoryGenerationPipeline>;
    try {
      pipelineAudit = auditStoryGenerationPipeline(mappedForGen, lineForGen, {
        brand: storyBrand,
      });
    } catch {
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

    // ≥45 → luxury phase "AI Thinking" for bay SSE while Grok runs
    await markAiJobProgress(msg.jobId, 55);

    const grokStartedAt = Date.now();
    let warrantyStory: string;
    let cdkSanitized = false;
    try {
      const rawStory = await generateWarrantyStory(mappedForGen, lineForGen, {
        pack: storyPack,
        preferredLanguage: session.preferredLanguage ?? 'en',
      });
      logPerformance('grok.story.generate.queue', Date.now() - grokStartedAt, {
        model: pipelineAudit.model,
        jobId: msg.jobId,
      });
      const cleaned = sanitizeForCDKWithMeta(rawStory);
      warrantyStory = cleaned.text;
      cdkSanitized = cleaned.wasModified;
    } catch (error) {
      logger.error('queue.story.generate.failed', {
        jobId: msg.jobId,
        error: error instanceof Error ? error.message : 'unknown',
        repairOrderId: roId,
        lineId,
      });
      throw error;
    }

    await markAiJobProgress(msg.jobId, 75);

    const lineWhere = scopedRepairLineWhereForSession(lineId, roId, session);
    const dealerId = resolveDealerIdForWrite({ session });

    await rlsTransaction(
      async (tx) => {
        await persistRepairLineStoryInTransaction(
          tx,
          {
            action: 'story.generate',
            dealershipId: session.dealershipId,
            dealerId: auditDealerIdFromSession(session),
            technicianId: session.technicianId,
            entityType: 'repairLine',
            entityId: lineId,
            metadata: {
              ...buildStoryGenerateAuditMetadata({
                repairOrderId: roId,
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
              asyncJobId: msg.jobId,
            },
            ipAddress: undefined,
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

        if (warrantyStory.trim().length > 0) {
          await recordFirstStoryGeneratedUsage(tx, {
            dealershipId: session.dealershipId,
            dealerId,
            repairOrderId: roId,
            repairLineId: lineId,
            lineWhere,
          });
        }
      },
      { ...rlsContextFromSession(session), enforced: true }
    );

    void logStoryTechnicianActivity({
      dealershipId: session.dealershipId,
      dealerId: auditDealerIdFromSession(session),
      technicianId: session.technicianId,
      event: 'story.generate',
      message: `Generated warranty story (async) for RO ${mapped.roNumber}, line ${line.lineNumber}`,
      repairOrderId: roId,
      repairLineId: lineId,
      roNumber: mapped.roNumber,
      lineNumber: line.lineNumber,
      metadata: {
        cdkSanitized,
        model: pipelineAudit.model,
        asyncJobId: msg.jobId,
      },
    });

    void broadcastCompanionEvent(session.technicianId, {
      type: 'ro.patch',
      repairOrderId: roId,
      lineId,
      linePatch: { warrantyStory },
    });

    await markAiJobProgress(msg.jobId, 95);

    return {
      warrantyStory,
      cdkSanitized,
      quality: null,
      repairOrderId: roId,
      lineId,
    };
  });
}

