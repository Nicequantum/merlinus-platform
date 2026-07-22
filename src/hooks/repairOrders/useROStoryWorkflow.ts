'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { ensureI18n } from '@/i18n/config';
import { api, ApiError } from '@/lib/api';
import { clientLog } from '@/lib/clientLog';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { OFFLINE_ERROR } from '@/lib/errors';
import { MI_PRODUCT_LABEL } from '@/lib/grokModels';
import { isStoryQualityCurrent } from '@/lib/storyQualityState';
import type { RepairLine, RepairOrder, StoryQualityResult, StoryReviewResult } from '@/types';

function storyT(key: string, options?: Record<string, unknown>): string {
  return ensureI18n().t(key, { ns: 'story', ...options });
}

function getLatestRoAndLine(
  roRef: React.MutableRefObject<RepairOrder | null>,
  lineId: string
): { ro: RepairOrder | null; line: RepairLine | undefined } {
  const ro = roRef.current;
  const line = ro?.repairLines.find((l) => l.id === lineId);
  return { ro, line };
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message === 'failed to fetch' || message === 'networkerror when attempting to fetch resource') {
      return true;
    }
    if (error.name === 'NetworkError') return true;
  }
  return false;
}

function getStoryWorkflowErrorMessage(error: unknown, fallback: string): string {
  if (isNetworkError(error)) return OFFLINE_ERROR;
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return fallback;
}

/** True when the on-screen warranty story no longer matches the text the async workflow used. */
function isWarrantyStoryStale(ro: RepairOrder, lineId: string, expectedStoryText: string): boolean {
  const line = ro.repairLines.find((l) => l.id === lineId);
  const currentStory = line?.warrantyStory?.trim() ?? '';
  const expectedStory = expectedStoryText.trim();
  if (!currentStory || !expectedStory) return true;
  return !isStoryQualityCurrent({ scoredAgainstStory: expectedStory } as StoryQualityResult, currentStory);
}

interface StoryWorkflowRefs {
  roRef: React.MutableRefObject<RepairOrder | null>;
  generateStorySeqRef: React.MutableRefObject<number>;
  scoreStorySeqRef: React.MutableRefObject<number>;
  reviewStorySeqRef: React.MutableRefObject<number>;
  storyGenerationInFlightRef: React.MutableRefObject<boolean>;
  storyScoringInFlightRef: React.MutableRefObject<boolean>;
  storyReviewInFlightRef: React.MutableRefObject<boolean>;
}

export interface StoryCertificationRecord {
  certifiedByName: string;
  certifiedAt: string;
  storyText: string;
}

interface StoryWorkflowSetters {
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  setGeneratingLineId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsScoring: React.Dispatch<React.SetStateAction<boolean>>;
  setScoringLineId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsReviewing: React.Dispatch<React.SetStateAction<boolean>>;
  setReviewingLineId: React.Dispatch<React.SetStateAction<string | null>>;
  setLastGeneratedStoryByLine: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setStoryQualityByLine: React.Dispatch<React.SetStateAction<Record<string, StoryQualityResult>>>;
  setStoryReviewByLine: React.Dispatch<React.SetStateAction<Record<string, StoryReviewResult>>>;
  setCdkSanitizedByLine: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setStoryCertificationByLine: React.Dispatch<React.SetStateAction<Record<string, StoryCertificationRecord>>>;
}

/** M21: story generation, review, and Customer Pay template workflow. */
export function useROStoryWorkflow(
  refs: StoryWorkflowRefs,
  setters: StoryWorkflowSetters,
  deps: {
    flushPendingSave: (options?: { maxWaitMs?: number }) => Promise<void>;
    applyROUpdate: (
      updater: (ro: RepairOrder) => RepairOrder,
      options?: { immediate?: boolean; skipPersist?: boolean }
    ) => RepairOrder | null;
    clearLineQualityState: (lineId: string) => void;
    clearLineCertification: (lineId: string) => void;
    invalidateReviewRequests: () => void;
    invalidateScoreRequests: () => void;
  }
) {
  const applyCustomerPayTemplate = useCallback(
    async (lineId: string, templateId: string) => {
      await deps.flushPendingSave();
      const { ro: latestRO, line } = getLatestRoAndLine(refs.roRef, lineId);
      if (!latestRO) return;
      const roId = latestRO.id;
      if (!line) {
        toast.error('Repair line not found — refresh the RO and try again');
        return;
      }

      deps.clearLineQualityState(lineId);
      deps.clearLineCertification(lineId);
      deps.invalidateReviewRequests();

      try {
        const result = await api.applyCustomerPayTemplate(roId, lineId, templateId);
        deps.applyROUpdate(
          (ro) => ({
            ...ro,
            repairLines: ro.repairLines.map((l) =>
              l.id === lineId ? { ...l, warrantyStory: result.warrantyStory, isCustomerPay: true } : l
            ),
          }),
          { immediate: true }
        );
        if (result.cdkSanitized) {
          setters.setCdkSanitizedByLine((prev) => ({ ...prev, [lineId]: true }));
        }
        if (!result.idempotent) {
          toast.success(`"${result.templateTitle}" applied — Customer Pay instant story`);
        }
      } catch (error: unknown) {
        toast.error(getStoryWorkflowErrorMessage(error, 'Failed to apply Customer Pay template'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters object is stable for hook lifetime
    [deps, refs.roRef]
  );

  const clearCustomerPayMode = useCallback(
    async (lineId: string) => {
      await deps.flushPendingSave();
      const { ro: latestRO } = getLatestRoAndLine(refs.roRef, lineId);
      if (!latestRO) return;
      try {
        await api.clearCustomerPayMode(latestRO.id, lineId);
        deps.applyROUpdate(
          (ro) => ({
            ...ro,
            repairLines: ro.repairLines.map((l) =>
              l.id === lineId ? { ...l, isCustomerPay: false, clearCustomerPay: true } : l
            ),
          }),
          { immediate: true }
        );
        toast.success('Customer Pay mode cleared — warranty AI generation is available');
      } catch (error: unknown) {
        toast.error(getStoryWorkflowErrorMessage(error, 'Failed to clear Customer Pay mode'));
      }
    },
    [deps, refs.roRef]
  );

  const generateStory = useCallback(
    async (lineId: string) => {
      if (refs.storyGenerationInFlightRef.current) {
        toast.message(storyT('generateInProgress'));
        return;
      }

      const seq = ++refs.generateStorySeqRef.current;
      refs.storyGenerationInFlightRef.current = true;
      setters.setGeneratingLineId(lineId);
      setters.setIsGenerating(true);
      const preLine = refs.roRef.current?.repairLines.find((l) => l.id === lineId);
      const isRevisionPass = Boolean(preLine?.warrantyStory?.trim() && preLine.warrantyStory.trim().length >= 40);
      toast.message(storyT('generateStarting'));

      try {
        if (refs.storyReviewInFlightRef.current) deps.invalidateReviewRequests();
        if (refs.storyScoringInFlightRef.current) deps.invalidateScoreRequests();
        // Never block generation on a stuck save queue (was causing multi-minute waits).
        // Critical before revision: notes + interim story enhancements must hit the server.
        await deps.flushPendingSave({ maxWaitMs: 2_500 });

        const { ro: latestRO, line: targetLine } = getLatestRoAndLine(refs.roRef, lineId);
        if (!latestRO) {
          toast.error(storyT('roNotLoaded'));
          return;
        }

        if (!targetLine) {
          toast.error(storyT('lineNotFound'));
          return;
        }
        if (isCustomerPayRepairLine(targetLine)) {
          toast.error(storyT('clearCustomerPayFirst'));
          return;
        }

        deps.clearLineQualityState(lineId);
        deps.clearLineCertification(lineId);
        deps.invalidateReviewRequests();
        deps.invalidateScoreRequests();
        // Send client-side notes + story so regenerate never races a lagging PUT.
        // Prefer durable async (CF Queue); poll until complete when jobId returned.
        const genResult = await api.generateStory(latestRO.id, lineId, {
          technicianNotes: targetLine.technicianNotes,
          warrantyStory: targetLine.warrantyStory,
          async: true,
        });
        if (seq !== refs.generateStorySeqRef.current) return;

        let warrantyStory = '';
        let cdkSanitized = false;

        if (genResult && typeof genResult === 'object' && 'async' in genResult && genResult.async === true) {
          // Optimistic bay feedback — SSE (or poll fallback) drives phase labels.
          // Immediate "Queued" feels instant even before the first SSE tick.
          const toastId = `story-job-${genResult.jobId}`;
          let optimisticProgress = 4;
          toast.message('Queued', {
            id: toastId,
            description: 'Story queued for the AI bay… · 4%',
          });
          // Smooth optimistic creep while waiting for first server phase (slow Wi‑Fi).
          const creep =
            typeof window !== 'undefined'
              ? window.setInterval(() => {
                  optimisticProgress = Math.min(18, optimisticProgress + 1);
                  toast.message('Queued', {
                    id: toastId,
                    description: `Waiting for AI bay… · ${optimisticProgress}%`,
                  });
                }, 900)
              : 0;
          const { pollAiJobUntilDone, phaseLabel, technicianFriendlyJobError } = await import(
            '@/lib/aiJobClient'
          );
          let lastToastPhase = '';
          let sawServerPhase = false;
          const done = await pollAiJobUntilDone(genResult.jobId, {
            timeoutMs: 130_000,
            preferSse: true,
            onPhase: (phase, progress, label) => {
              if (!sawServerPhase) {
                sawServerPhase = true;
                if (creep) window.clearInterval(creep);
              }
              if (phase === lastToastPhase && phase !== 'ai_thinking') return;
              lastToastPhase = phase;
              if (phase === 'complete' || phase === 'failed' || phase === 'cancelled') return;
              const phaseTitle =
                phase === 'queued'
                  ? 'Queued'
                  : phase === 'processing'
                    ? 'Processing'
                    : phase === 'ai_thinking'
                      ? 'AI Thinking'
                      : phaseLabel(phase);
              // Never show progress going backwards vs optimistic creep
              const displayProgress = Math.max(progress, optimisticProgress);
              toast.message(phaseTitle, {
                id: toastId,
                description: `${label || phaseLabel(phase)}${
                  displayProgress > 0 ? ` · ${displayProgress}%` : ''
                }`,
              });
            },
          });
          if (creep) window.clearInterval(creep);
          if (seq !== refs.generateStorySeqRef.current) return;
          if (done.phase === 'failed' || done.phase === 'cancelled') {
            throw new Error(
              technicianFriendlyJobError(done.errorMessage) || storyT('generateFailed')
            );
          }
          const result = done.result as {
            warrantyStory?: string;
            cdkSanitized?: boolean;
          } | null;
          warrantyStory = result?.warrantyStory?.trim() || '';
          cdkSanitized = Boolean(result?.cdkSanitized);
          if (!warrantyStory) {
            throw new Error(storyT('generateFailed') || 'Story job completed without text');
          }
          toast.dismiss(toastId);
        } else {
          const sync = genResult as {
            warrantyStory: string;
            cdkSanitized?: boolean;
          };
          warrantyStory = sync.warrantyStory;
          cdkSanitized = Boolean(sync.cdkSanitized);
        }

        setters.setLastGeneratedStoryByLine((prev) => ({ ...prev, [lineId]: warrantyStory }));
        if (cdkSanitized) {
          setters.setCdkSanitizedByLine((prev) => ({ ...prev, [lineId]: true }));
        } else {
          setters.setCdkSanitizedByLine((prev) => {
            const next = { ...prev };
            delete next[lineId];
            return next;
          });
        }
        // Local state only — generate-story API already persisted the story; avoid racing PUTs.
        deps.applyROUpdate(
          (ro) => ({
            ...ro,
            repairLines: ro.repairLines.map((l) =>
              l.id === lineId ? { ...l, warrantyStory, storyQualityAudit: null } : l
            ),
          }),
          { skipPersist: true }
        );
        if (cdkSanitized) {
          toast.message(storyT('cdkCleaned'));
        }

        // Story is saved — release the UI immediately; score asynchronously.
        refs.storyGenerationInFlightRef.current = false;
        setters.setIsGenerating(false);
        setters.setGeneratingLineId(null);
        toast.success(isRevisionPass ? storyT('generatedRevision') : storyT('generated'));
      } catch (error: unknown) {
        if (seq === refs.generateStorySeqRef.current) {
          clientLog.error('story.generate_failed', error);
          const { technicianFriendlyJobError } = await import('@/lib/aiJobClient');
          const raw = getStoryWorkflowErrorMessage(error, storyT('generateFailed'));
          const friendly =
            raw === OFFLINE_ERROR ? raw : technicianFriendlyJobError(raw);
          toast.error(friendly, {
            duration: 14_000,
            action: {
              label: 'Retry',
              onClick: () => {
                void generateStory(lineId);
              },
            },
            cancel: {
              label: 'Contact Manager',
              onClick: () => {
                toast.message(
                  'Ask your service manager to open Manager Dashboard → AI Jobs for retry or cancel.',
                  { duration: 10_000 }
                );
              },
            },
          });
        }
      } finally {
        if (seq === refs.generateStorySeqRef.current && refs.storyGenerationInFlightRef.current) {
          refs.storyGenerationInFlightRef.current = false;
          setters.setIsGenerating(false);
          setters.setGeneratingLineId(null);
        }
      }
    },
    [deps, refs, setters]
  );

  const scoreStory = useCallback(
    async (lineId: string, storyTextOverride?: string) => {
      if (refs.storyScoringInFlightRef.current) {
        toast.message('Story audit already in progress…');
        return;
      }
      if (refs.storyGenerationInFlightRef.current) {
        toast.error('Wait for story generation to finish before auditing');
        return;
      }

      const seq = ++refs.scoreStorySeqRef.current;
      refs.storyScoringInFlightRef.current = true;
      setters.setScoringLineId(lineId);
      setters.setIsScoring(true);
      toast.message('Running MI quality audit…');

      try {
        // Lock + loading before flush so the first click always gets feedback (was multi-click bug).
        await deps.flushPendingSave({ maxWaitMs: 2_500 });

        const { ro: latestRO, line: targetLine } = getLatestRoAndLine(refs.roRef, lineId);
        if (isCustomerPayRepairLine(targetLine)) {
          toast.message('Customer Pay stories skip AI audit — edit the text if needed.');
          return;
        }
        if (!latestRO) {
          toast.error('Repair order not loaded — go back and reopen the line');
          return;
        }
        const roId = latestRO.id;
        const storyText = (storyTextOverride?.trim() || targetLine?.warrantyStory?.trim()) ?? '';
        if (!storyText) {
          toast.error('Generate or write a warranty story before running the audit');
          return;
        }

        setters.setStoryReviewByLine((prev) => {
          if (!prev[lineId]) return prev;
          const next = { ...prev };
          delete next[lineId];
          return next;
        });

        const { quality } = await api.scoreStory(roId, lineId, storyText, {
          technicianNotes: targetLine?.technicianNotes,
        });
        if (seq !== refs.scoreStorySeqRef.current) return;

        const activeRO = refs.roRef.current;
        if (!activeRO || activeRO.id !== roId) {
          toast.success('Audit complete — reopen the repair line to view the score');
          return;
        }
        if (isWarrantyStoryStale(activeRO, lineId, storyText)) {
          toast.message('Story changed during audit — run Audit Story again.');
          return;
        }

        const persistedQuality = { ...quality, scoredAgainstStory: storyText };
        setters.setStoryCertificationByLine((prev) => {
          if (!prev[lineId]) return prev;
          const next = { ...prev };
          delete next[lineId];
          return next;
        });
        setters.setStoryQualityByLine((prev) => ({
          ...prev,
          [lineId]: persistedQuality,
        }));
        deps.applyROUpdate(
          (ro) => ({
            ...ro,
            repairLines: ro.repairLines.map((l) =>
              l.id === lineId
                ? { ...l, storyQualityAudit: persistedQuality, clearStoryQualityAudit: undefined }
                : l
            ),
          }),
          { skipPersist: true }
        );
        toast.success(`MI audit score: ${quality.score}/100 (${quality.grade})`);
      } catch (error: unknown) {
        if (seq === refs.scoreStorySeqRef.current) {
          clientLog.error('story.audit_failed', error);
          toast.error(getStoryWorkflowErrorMessage(error, 'Story audit failed'));
        }
      } finally {
        if (seq === refs.scoreStorySeqRef.current) {
          refs.storyScoringInFlightRef.current = false;
          setters.setIsScoring(false);
          setters.setScoringLineId(null);
        }
      }
    },
    [deps, refs, setters]
  );

  const reviewStory = useCallback(
    async (lineId: string, storyTextOverride?: string) => {
      if (refs.storyReviewInFlightRef.current) {
        toast.message('AI review already in progress…');
        return;
      }
      if (refs.storyScoringInFlightRef.current) {
        toast.error('Wait for the audit to finish before running a full review');
        return;
      }
      if (refs.storyGenerationInFlightRef.current) {
        toast.error('Wait for story generation to finish before reviewing');
        return;
      }

      deps.clearLineQualityState(lineId);
      deps.clearLineCertification(lineId);
      const seq = ++refs.reviewStorySeqRef.current;
      refs.storyReviewInFlightRef.current = true;
      setters.setReviewingLineId(lineId);
      setters.setIsReviewing(true);
      toast.message(`Running full ${MI_PRODUCT_LABEL} review…`);

      try {
        await deps.flushPendingSave({ maxWaitMs: 2_500 });

        const { ro: latestRO, line: targetLine } = getLatestRoAndLine(refs.roRef, lineId);
        if (isCustomerPayRepairLine(targetLine)) {
          toast.message('Customer Pay stories skip AI review — edit the text if needed.');
          return;
        }
        if (!latestRO) {
          toast.error('Repair order not loaded — go back and reopen the line');
          return;
        }
        const roId = latestRO.id;
        const storyText = (storyTextOverride?.trim() || targetLine?.warrantyStory?.trim()) ?? '';
        if (!storyText) {
          toast.error('Write or generate a warranty story before reviewing');
          return;
        }

        const { review } = await api.reviewStory(roId, lineId, storyText);
        if (seq !== refs.reviewStorySeqRef.current) return;

        const activeRO = refs.roRef.current;
        if (!activeRO || activeRO.id !== roId) {
          toast.success('Review complete — reopen the repair line to view feedback');
          return;
        }
        if (isWarrantyStoryStale(activeRO, lineId, storyText)) {
          toast.message('Story changed during review — run the review again.');
          return;
        }

        if (review.scoredAgainstStory?.trim() !== storyText) {
          review.scoredAgainstStory = storyText;
        }

        setters.setStoryCertificationByLine((prev) => {
          if (!prev[lineId]) return prev;
          const next = { ...prev };
          delete next[lineId];
          return next;
        });
        setters.setStoryReviewByLine((prev) => ({ ...prev, [lineId]: review }));
        setters.setStoryQualityByLine((prev) => ({ ...prev, [lineId]: review }));
        deps.applyROUpdate(
          (ro) => ({
            ...ro,
            repairLines: ro.repairLines.map((l) =>
              l.id === lineId
                ? { ...l, storyQualityAudit: review, clearStoryQualityAudit: undefined }
                : l
            ),
          }),
          { skipPersist: true }
        );
        toast.success(`${MI_PRODUCT_LABEL} review complete — ${review.score}/100 (${review.grade})`);
      } catch (error: unknown) {
        if (seq === refs.reviewStorySeqRef.current) {
          clientLog.error('story.review_failed', error);
          toast.error(getStoryWorkflowErrorMessage(error, 'Story review failed'));
        }
      } finally {
        if (seq === refs.reviewStorySeqRef.current) {
          refs.storyReviewInFlightRef.current = false;
          setters.setIsReviewing(false);
          setters.setReviewingLineId(null);
        }
      }
    },
    [deps, refs, setters]
  );

  return { applyCustomerPayTemplate, clearCustomerPayMode, generateStory, scoreStory, reviewStory };
}