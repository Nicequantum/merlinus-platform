'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { clientLog } from '@/lib/clientLog';
import { sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';
import type {
  AppView,
  RepairLine,
  RepairOrder,
  RepairOrderSummary,
  StoryQualityResult,
  StoryReviewResult,
  TechnicianSession,
} from '@/types';


import { useROComplaints } from '@/hooks/repairOrders/useROComplaints';
import { useROList } from '@/hooks/repairOrders/useROList';
import { useROPersistence } from '@/hooks/repairOrders/useROPersistence';
import { useROScan } from '@/hooks/repairOrders/useROScan';
import { useROSearch } from '@/hooks/repairOrders/useROSearch';
import {
  useROStoryWorkflow,
  type StoryCertificationRecord,
} from '@/hooks/repairOrders/useROStoryWorkflow';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { hydrateStoryWorkflowFromRO } from '@/lib/storyCertificationClient';
import { hydrateStoryQualityFromRO } from '@/lib/storyQualityHydration';
import {
  createManualRepairOrder,
  createNewRepairLine,
  ensureComplaintIds,
} from '@/utils/repairOrderFactory';
import { repairOrderToSummary } from '@/utils/repairOrderSummary';
import { deriveCurrentLineStoryState } from '@/hooks/repairOrders/currentLineStoryState';
import { removeImageAtIndex } from '@/hooks/repairOrders/roImageUtils';
import {
  readXentryBaseline,
  readXentryViewState,
  type XentryTarget,
} from '@/hooks/repairOrders/xentryDataModel';
import { countXentryImagesNeedingAnalysis } from '@/lib/xentryAnalysisState';
import { useROXentryScan } from '@/hooks/repairOrders/useROXentryScan';
import type { VisionPipelineControls, VisionPipelineId } from '@/hooks/visionPipeline';
import { isStoryCertificationPendingForLine } from '@/hooks/repairOrders/storyCertificationPending';
import { resetStoryWorkflowUiState } from '@/hooks/repairOrders/storyWorkflowUiReset';
import { applyCompanionROPatch } from '@/lib/companionMerge';
import { mergePersistedWithClient } from '@/lib/repairOrderMerge';
import {
  companionSnapshotHasChanges,
  diffCompanionRepairOrder,
  type CompanionSnapshotDelta,
} from '@/lib/companionSnapshot';

import { uploadFilesAsAttachments } from '@/utils/uploadHelpers';

interface UseRepairOrdersOptions {
  session: TechnicianSession | null;
  roScanPipeline: VisionPipelineControls;
  xentryPipeline: VisionPipelineControls;
  getActivePipeline: () => VisionPipelineId | null;
  onComplianceRequired?: () => void;
}

export function useRepairOrders({
  session,
  roScanPipeline,
  xentryPipeline,
  getActivePipeline,
  onComplianceRequired,
}: UseRepairOrdersOptions) {
  const [view, setView] = useState<AppView>('home');
  const [currentRO, setCurrentRO] = useState<RepairOrder | null>(null);
  const [currentLineId, setCurrentLineId] = useState<string | null>(null);
  const currentLineIdRef = useRef<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingLineId, setGeneratingLineId] = useState<string | null>(null);
  const [lastGeneratedStoryByLine, setLastGeneratedStoryByLine] = useState<Record<string, string>>({});
  const [cdkSanitizedByLine, setCdkSanitizedByLine] = useState<Record<string, boolean>>({});
  const [storyQualityByLine, setStoryQualityByLine] = useState<Record<string, StoryQualityResult>>({});
  const [storyReviewByLine, setStoryReviewByLine] = useState<Record<string, StoryReviewResult>>({});
  const [storyCertificationByLine, setStoryCertificationByLine] = useState<
    Record<string, StoryCertificationRecord>
  >({});
  const [isCertifyingStory, setIsCertifyingStory] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [scoringLineId, setScoringLineId] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewingLineId, setReviewingLineId] = useState<string | null>(null);
  const [openingROId, setOpeningROId] = useState<string | null>(null);
  const [companionRevision, setCompanionRevision] = useState(0);
  const roRef = useRef<RepairOrder | null>(null);
  const openingROInFlightRef = useRef<string | null>(null);
  const openingROPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const scanInFlightRef = useRef(false);
  const xentryInFlightRef = useRef(false);
  const generateStorySeqRef = useRef(0);
  const storyGenerationInFlightRef = useRef(false);
  const scoreStorySeqRef = useRef(0);
  const storyScoringInFlightRef = useRef(false);
  const reviewStorySeqRef = useRef(0);
  const storyReviewInFlightRef = useRef(false);

  useEffect(() => {
    // While a scan or diagnostic batch is finishing, roRef is updated optimistically.
    if (scanInFlightRef.current || xentryInFlightRef.current) return;
    roRef.current = currentRO;
  }, [currentRO]);

  useEffect(() => {
    currentLineIdRef.current = currentLineId;
  }, [currentLineId]);

  const {
    allROs,
    setAllROs,
    loading,
    listError,
    listRetrying,
    retryListLoad,
    refreshList,
    setTodayStartIso,
    previousROs,
    previousExpanded,
    togglePreviousExpanded,
    previousLoading,
    previousLoadingMore,
    previousHasMore,
    loadMorePrevious,
    todayROs,
  } = useROList(session, { onComplianceRequired });

  const {
    flushPendingSave,
    cancelPendingSave,
    applyROUpdate,
    saveROImmediate,
    persistRO,
    isLocallyDirty,
    markCleanFromServer,
  } = useROPersistence(allROs, setAllROs, roRef, setCurrentRO);

  const syncROView = useCallback((ro: RepairOrder) => {
    roRef.current = ro;
    setCurrentRO(ro);
    setAllROs((prev) => {
      const summary = repairOrderToSummary(ro);
      const idx = prev.findIndex((r) => r.id === ro.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = summary;
        return copy;
      }
      return [summary, ...prev];
    });
  }, [setAllROs]);

  const xentryScan = useROXentryScan({
    roRef,
    flushPendingSave,
    saveROImmediate,
    xentryInFlightRef,
    xentryPipeline,
    getActivePipeline,
    syncROView,
  });

  const prepareForScan = useCallback(async () => {
    await flushPendingSave();
    cancelPendingSave();
  }, [cancelPendingSave, flushPendingSave]);

  const openScanResultView = useCallback(
    (repairOrder: RepairOrder) => {
      const normalized = ensureComplaintIds(repairOrder);
      flushSync(() => {
        roRef.current = normalized;
        setAllROs((prev) => [
          repairOrderToSummary(normalized),
          ...prev.filter((r) => r.id !== normalized.id),
        ]);
        setCurrentLineId(null);
        setCurrentRO(normalized);
        setView('ro');
      });
    },
    [setAllROs]
  );

  const navigateView = useCallback(
    async (next: AppView) => {
      await flushPendingSave();
      if (next === 'home') {
        roRef.current = null;
        setCurrentRO(null);
        setCurrentLineId(null);
      }
      setView(next);
    },
    [flushPendingSave]
  );

  const { searchTerm, setSearchTerm, searchLoading, searchROs } = useROSearch({
    session,
    allROs,
    setAllROs,
    setTodayStartIso,
  });

  const {
    pendingROImages,
    setPendingROImages,
    scanRO,
    addScanPagesFromGallery,
    processPendingScan,
    clearPendingScan,
    cancelScan,
    removePendingScanPage,
  } = useROScan({
    prepareForScan,
    openScanResultView,
    scanInFlightRef,
    roScanPipeline,
    getActivePipeline,
  });

  const { addComplaint, removeComplaint, editComplaint, updateRONumber } = useROComplaints({
    roRef,
    applyROUpdate,
  });

  /** Prevent blank screen when view points at RO/line but selection was cleared mid-scan. */
  useEffect(() => {
    if (scanInFlightRef.current || xentryInFlightRef.current) return;
    if (view === 'ro' && !currentRO) {
      setView('home');
      return;
    }
    if (view === 'line') {
      const lineExists =
        !!currentRO && !!currentLineId && currentRO.repairLines.some((line) => line.id === currentLineId);
      if (!lineExists) {
        setView(currentRO ? 'ro' : 'home');
      }
    }
  }, [view, currentRO, currentLineId]);

  const deleteRO = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this RO and all its data?')) return;
      try {
        await api.deleteRepairOrder(id);
        setAllROs((prev) => prev.filter((r) => r.id !== id));
        if (currentRO?.id === id) {
          setCurrentRO(null);
          setCurrentLineId(null);
          setLastGeneratedStoryByLine({});
          setStoryQualityByLine({});
          setStoryReviewByLine({});
          resetStoryWorkflowUiState(
            {
              generateStorySeqRef,
              scoreStorySeqRef,
              reviewStorySeqRef,
              storyGenerationInFlightRef,
              storyScoringInFlightRef,
              storyReviewInFlightRef,
            },
            {
              setIsGenerating,
              setGeneratingLineId,
              setIsScoring,
              setScoringLineId,
              setIsReviewing,
              setReviewingLineId,
            }
          );
          setView('home');
        }
        toast.success('Repair order deleted');
      } catch (e) {
        clientLog.error('ro.delete_failed', e);
        toast.error(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setAllROs is a stable state setter
    [currentRO]
  );

  const openROById = useCallback(
    async (id: string) => {
      const inFlight = openingROPromisesRef.current.get(id);
      if (inFlight) {
        await inFlight;
        return;
      }

      const loadPromise = (async () => {
        openingROInFlightRef.current = id;
        setOpeningROId(id);
        await flushPendingSave();
        try {
          const { repairOrder } = await api.getRepairOrder(id);
          const normalized = ensureComplaintIds(repairOrder);
          if (normalized.piiDecryptWarnings?.length) {
            const preview = normalized.piiDecryptWarnings.slice(0, 3).join(', ');
            const extra =
              normalized.piiDecryptWarnings.length > 3
                ? ` (+${normalized.piiDecryptWarnings.length - 3} more)`
                : '';
            toast.warning(
              `Some encrypted fields could not be read: ${preview}${extra}. Contact your manager if data looks missing.`
            );
          }
          roRef.current = normalized;
          setCurrentRO(normalized);
          const preservedLineId = currentLineIdRef.current;
          setCurrentLineId(
            preservedLineId && normalized.repairLines.some((line) => line.id === preservedLineId)
              ? preservedLineId
              : null
          );
          const { qualityByLine, reviewByLine } = hydrateStoryQualityFromRO(normalized);
          const { certificationByLine, lastGeneratedByLine } = hydrateStoryWorkflowFromRO(normalized);
          setLastGeneratedStoryByLine(lastGeneratedByLine);
          setStoryCertificationByLine(certificationByLine);
          setStoryQualityByLine(qualityByLine);
          setStoryReviewByLine(reviewByLine);
          resetStoryWorkflowUiState(
            {
              generateStorySeqRef,
              scoreStorySeqRef,
              reviewStorySeqRef,
              storyGenerationInFlightRef,
              storyScoringInFlightRef,
              storyReviewInFlightRef,
            },
            {
              setIsGenerating,
              setGeneratingLineId,
              setIsScoring,
              setScoringLineId,
              setIsReviewing,
              setReviewingLineId,
            }
          );
          setAllROs((prev) => {
            const summary = repairOrderToSummary(normalized);
            const idx = prev.findIndex((r) => r.id === normalized.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = summary;
              return copy;
            }
            return [summary, ...prev];
          });
          const restoredLineId =
            preservedLineId &&
            normalized.repairLines.some((repairLine) => repairLine.id === preservedLineId)
              ? preservedLineId
              : null;
          flushSync(() => {
            setCurrentLineId(restoredLineId);
            setView(restoredLineId ? 'line' : 'ro');
          });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Failed to load repair order');
          throw e;
        } finally {
          if (openingROInFlightRef.current === id) {
            openingROInFlightRef.current = null;
          }
          setOpeningROId((current) => (current === id ? null : current));
        }
      })();

      openingROPromisesRef.current.set(id, loadPromise);
      try {
        await loadPromise;
      } finally {
        openingROPromisesRef.current.delete(id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setAllROs is a stable state setter
    [flushPendingSave, navigateView]
  );

  const bumpCompanionRevision = useCallback(() => {
    setCompanionRevision((value) => value + 1);
  }, []);

  const ensureRepairOrderOpen = useCallback(
    async (repairOrderId: string) => {
      if (roRef.current?.id === repairOrderId) return;
      await openROById(repairOrderId);
    },
    [openROById]
  );

  const syncCompanionRepairOrderSnapshot = useCallback(
    async (
      repairOrderId: string,
      options?: { lineId?: string | null }
    ): Promise<CompanionSnapshotDelta | null> => {
      if (roRef.current?.id !== repairOrderId) return null;

      // Never full-replace while the tech has unsaved local edits or a PUT in flight.
      if (isLocallyDirty()) {
        return null;
      }

      const previous = roRef.current;
      try {
        const { repairOrder } = await api.getRepairOrder(repairOrderId);
        // Merge so any edge-race local fields still win over remote.
        const normalized = ensureComplaintIds(
          mergePersistedWithClient(repairOrder, roRef.current)
        );
        const delta = diffCompanionRepairOrder(previous, normalized);
        if (!companionSnapshotHasChanges(delta)) {
          return null;
        }
        const preservedLineId = options?.lineId ?? currentLineIdRef.current;
        const { qualityByLine, reviewByLine } = hydrateStoryQualityFromRO(normalized);
        const { certificationByLine, lastGeneratedByLine } = hydrateStoryWorkflowFromRO(normalized);

        flushSync(() => {
          roRef.current = normalized;
          setCurrentRO(normalized);
          markCleanFromServer();
          if (preservedLineId && normalized.repairLines.some((line) => line.id === preservedLineId)) {
            setCurrentLineId(preservedLineId);
          }
          setStoryQualityByLine(qualityByLine);
          setStoryReviewByLine(reviewByLine);
          setStoryCertificationByLine(certificationByLine);
          setLastGeneratedStoryByLine(lastGeneratedByLine);
          setAllROs((prev) =>
            prev.map((entry) =>
              entry.id === normalized.id ? repairOrderToSummary(normalized) : entry
            )
          );
          bumpCompanionRevision();
        });

        return delta;
      } catch (error) {
        clientLog.warn('companion.snapshot_sync_failed', { repairOrderId, error });
        return null;
      }
    },
    [bumpCompanionRevision, isLocallyDirty, markCleanFromServer, setAllROs]
  );

  const openRO = useCallback(
    (target: RepairOrder | RepairOrderSummary | string) => {
      const id = typeof target === 'string' ? target : target.id;
      void openROById(id);
    },
    [openROById]
  );

  const createManualRO = useCallback(async () => {
    try {
      const draft = createManualRepairOrder();
      const { repairOrder } = await api.createRepairOrder(draft, {
        idempotencyKey: `manual-${draft.id}`.slice(0, 128),
      });
      const withIds = ensureComplaintIds(
        draft.complaintIds && draft.complaintIds.length === repairOrder.complaints.length
          ? { ...repairOrder, complaintIds: draft.complaintIds }
          : repairOrder
      );
      roRef.current = withIds;
      setAllROs((prev) => [repairOrderToSummary(withIds), ...prev]);
      setCurrentRO(withIds);
      navigateView('ro');
      toast.success('Manual repair order created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setAllROs is a stable state setter
  }, [navigateView]);

  const isStoryCertificationPending = useCallback(
    (lineId: string, line?: RepairLine): boolean => {
      const targetLine = line ?? roRef.current?.repairLines.find((l) => l.id === lineId);
      return isStoryCertificationPendingForLine(
        lineId,
        targetLine,
        lastGeneratedStoryByLine,
        storyQualityByLine,
        storyCertificationByLine
      );
    },
    [lastGeneratedStoryByLine, roRef, storyCertificationByLine, storyQualityByLine]
  );

  const updateLine = useCallback(
    (lineId: string, updates: Partial<RepairLine>, options?: { immediate?: boolean }) => {
      let nextUpdates = updates;
      if (updates.warrantyStory !== undefined) {
        const { text, wasModified } = sanitizeForCDKWithMeta(updates.warrantyStory);
        nextUpdates = { ...updates, warrantyStory: text };
        if (wasModified) {
          setCdkSanitizedByLine((prev) => ({ ...prev, [lineId]: true }));
        }
      }

      // Never skip persist when notes/corrections are included (Add Tech Details must hit DB
      // before regenerate). Only skip bare story edits during certification pending.
      const skipPersist =
        updates.warrantyStory !== undefined &&
        updates.technicianNotes === undefined &&
        isStoryCertificationPending(lineId);

      const lightKeys = Object.keys(nextUpdates);
      const isLight =
        lightKeys.length > 0 &&
        lightKeys.every((k) =>
          ['description', 'customerConcern', 'technicianNotes', 'warrantyStory'].includes(k)
        );

      applyROUpdate(
        (ro) => ({
          ...ro,
          repairLines: ro.repairLines.map((line) =>
            line.id === lineId ? { ...line, ...nextUpdates } : line
          ),
        }),
        skipPersist
          ? { skipPersist: true }
          : isLight
            ? {
                immediate: options?.immediate,
                linePatch: { lineId, fields: nextUpdates },
              }
            : options?.immediate
              ? { immediate: true }
              : undefined
      );
    },
    [applyROUpdate, isStoryCertificationPending]
  );

  const updateVehicle = useCallback(
    (updates: Partial<RepairOrder['vehicle']>) => {
      const normalized = { ...updates };
      if (normalized.vin !== undefined) normalized.vin = normalized.vin.toUpperCase();
      applyROUpdate((ro) => ({ ...ro, vehicle: { ...ro.vehicle, ...normalized } }));
    },
    [applyROUpdate]
  );

  const updateCustomer = useCallback(
    (name: string) => {
      applyROUpdate((ro) => ({ ...ro, customer: { ...ro.customer, name } }));
    },
    [applyROUpdate]
  );

  const decodeVinForRO = useCallback(async () => {
    flushPendingSave();
    const latestRO = roRef.current;
    if (!latestRO?.vehicle.vin || latestRO.vehicle.vin.length < 17) {
      toast.error('Enter a valid 17-character VIN first');
      return;
    }
    try {
      const result = await api.decodeVin(latestRO.vehicle.vin);
      if (!result.valid) {
        toast.error('VIN could not be decoded — verify and try again');
        return;
      }
      updateVehicle({
        year: result.year || latestRO.vehicle.year,
        make: result.make || latestRO.vehicle.make,
        model: result.model || latestRO.vehicle.model,
        engine: result.engine || latestRO.vehicle.engine,
      });
      toast.success('Vehicle details filled from NHTSA VIN decode');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'VIN decode failed');
    }
  }, [flushPendingSave, updateVehicle]);

  const addRepairLine = useCallback(async () => {
    flushPendingSave();
    const latestRO = roRef.current;
    if (!latestRO) return;
    const newLine = createNewRepairLine(latestRO.repairLines.length + 1);
    const updated = { ...latestRO, repairLines: [...latestRO.repairLines, newLine] };
    const saved = ensureComplaintIds(await persistRO(updated));
    roRef.current = saved;
    setCurrentRO(saved);
    setAllROs((prev) =>
      prev.map((r) => (r.id === saved.id ? repairOrderToSummary(saved) : r))
    );
    setCurrentLineId(saved.repairLines[saved.repairLines.length - 1].id);
    navigateView('line');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setAllROs is a stable state setter
  }, [flushPendingSave, navigateView, persistRO]);

  const deleteLineXentryImage = useCallback(
    async (lineId: string, imageId: string) => {
      if (!window.confirm('Delete this diagnostic photo? Extracted data will be updated.')) return;
      const latestRO = roRef.current;
      if (!latestRO) return;
      const line = latestRO.repairLines.find((l) => l.id === lineId);
      if (!line) return;

      const result = removeImageAtIndex(line.xentryImages || [], line.xentryOcrTexts || [], imageId);
      if (!result) return;

      const updatedLines = latestRO.repairLines.map((l) =>
        l.id === lineId
          ? {
              ...l,
              xentryImages: result.nextImages,
              xentryOcrTexts: result.nextOcr,
              extractedData: result.rebuilt,
            }
          : l
      );
      try {
        await saveROImmediate({ ...latestRO, repairLines: updatedLines });
        toast.success('Diagnostic photo deleted');
      } catch (error: unknown) {
        clientLog.error('ro.delete_diagnostic_photo_failed', error);
        toast.error(error instanceof Error ? error.message : 'Failed to delete diagnostic photo');
      }
    },
    [saveROImmediate]
  );

  const deleteROXentryImage = useCallback(
    async (imageId: string) => {
      if (!window.confirm('Delete this Xentry photo? Extracted data will be updated.')) return;
      const latestRO = roRef.current;
      if (!latestRO) return;

      const result = removeImageAtIndex(latestRO.xentryImages || [], latestRO.xentryOcrTexts || [], imageId);
      if (!result) return;

      const line0 = latestRO.repairLines[0];
      const updatedLines = line0
        ? latestRO.repairLines.map((line, idx) =>
            idx === 0 ? { ...line, extractedData: result.rebuilt } : line
          )
        : latestRO.repairLines;

      try {
        await saveROImmediate({
          ...latestRO,
          xentryImages: result.nextImages,
          xentryOcrTexts: result.nextOcr,
          repairLines: updatedLines,
        });
        toast.success('Xentry photo deleted');
      } catch (error: unknown) {
        clientLog.error('ro.delete_xentry_photo_failed', error);
        toast.error(error instanceof Error ? error.message : 'Failed to delete Xentry photo');
      }
    },
    [saveROImmediate]
  );

  const buildXentrySection = useCallback(
    (target: XentryTarget) => {
      const viewState = readXentryViewState(currentRO, target);
      const baseline = currentRO ? readXentryBaseline(currentRO, target) : null;
      const imagesNeedingAnalysisCount = baseline
        ? countXentryImagesNeedingAnalysis(baseline.images, baseline.ocrTexts)
        : 0;

      return {
        savedImages: viewState.images,
        pendingImages: xentryScan.getPendingImages(target),
        imagesNeedingAnalysisCount,
        extractedData: viewState.extracted,
        onCapturePhoto: () => xentryScan.capturePhoto(target),
        onAddFromGallery: () => xentryScan.addFromGallery(target),
        onProcessImages: () => void xentryScan.processPending(target),
        onClearPending: () => xentryScan.clearPending(target),
        onCancelProcessing: () => xentryScan.cancelProcessing(),
        onDeletePendingImage: (imageId: string) => xentryScan.removePendingImage(target, imageId),
        onDeleteSavedImage:
          target.scope === 'line'
            ? (imageId: string) => void deleteLineXentryImage(target.lineId, imageId)
            : (imageId: string) => void deleteROXentryImage(imageId),
      };
    },
    [currentRO, deleteLineXentryImage, deleteROXentryImage, xentryScan]
  );

  const invalidateReviewRequests = useCallback(() => {
    reviewStorySeqRef.current += 1;
    storyReviewInFlightRef.current = false;
    setIsReviewing(false);
    setReviewingLineId(null);
  }, []);

  const invalidateScoreRequests = useCallback(() => {
    scoreStorySeqRef.current += 1;
    storyScoringInFlightRef.current = false;
    setIsScoring(false);
    setScoringLineId(null);
  }, []);

  const clearLineQualityState = useCallback(
    (lineId: string) => {
      setStoryQualityByLine((prev) => {
        if (!prev[lineId]) return prev;
        const next = { ...prev };
        delete next[lineId];
        return next;
      });
      setStoryReviewByLine((prev) => {
        if (!prev[lineId]) return prev;
        const next = { ...prev };
        delete next[lineId];
        return next;
      });
      applyROUpdate(
        (ro) => ({
          ...ro,
          repairLines: ro.repairLines.map((line) =>
            line.id === lineId
              ? { ...line, storyQualityAudit: null, clearStoryQualityAudit: true }
              : line
          ),
        }),
        { immediate: true }
      );
    },
    [applyROUpdate]
  );

  const clearLineCertification = useCallback((lineId: string) => {
    setStoryCertificationByLine((prev) => {
      if (!prev[lineId]) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }, []);

  const { applyCustomerPayTemplate, clearCustomerPayMode, generateStory, scoreStory, reviewStory } =
    useROStoryWorkflow(
      {
        roRef,
        generateStorySeqRef,
        scoreStorySeqRef,
        reviewStorySeqRef,
        storyGenerationInFlightRef,
        storyScoringInFlightRef,
        storyReviewInFlightRef,
      },
      {
        setIsGenerating,
        setGeneratingLineId,
        setIsScoring,
        setScoringLineId,
        setIsReviewing,
        setReviewingLineId,
        setLastGeneratedStoryByLine,
        setStoryQualityByLine,
        setStoryReviewByLine,
        setCdkSanitizedByLine,
        setStoryCertificationByLine,
      },
      {
        flushPendingSave,
        applyROUpdate,
        clearLineQualityState,
        clearLineCertification,
        invalidateReviewRequests,
        invalidateScoreRequests,
      }
    );

  const certifyAndSaveStory = useCallback(
    async (lineId: string, warrantyStory: string, certifiedByName: string) => {
      await flushPendingSave();
      const latestRO = roRef.current;
      if (!latestRO) {
        toast.error('Repair order not loaded — go back and reopen the line');
        return;
      }

      const line = latestRO.repairLines.find((l) => l.id === lineId);
      if (!line) {
        toast.error('Repair line not found — refresh the RO and try again');
        return;
      }
      if (isCustomerPayRepairLine(line)) {
        toast.error('Customer Pay stories do not require certification');
        return;
      }

      setIsCertifyingStory(true);
      try {
        const result = await api.certifyStory(
          latestRO.id,
          lineId,
          warrantyStory,
          certifiedByName.trim()
        );
        const certifiedStory = result.warrantyStory.trim();
        setStoryCertificationByLine((prev) => ({
          ...prev,
          [lineId]: {
            certifiedByName: result.certifiedByName,
            certifiedAt: result.certifiedAt,
            storyText: certifiedStory,
          },
        }));
        applyROUpdate(
          (ro) => ({
            ...ro,
            repairLines: ro.repairLines.map((l) =>
              l.id === lineId
                ? {
                    ...l,
                    warrantyStory: result.warrantyStory,
                    storyCertification: {
                      certifiedByName: result.certifiedByName,
                      certifiedAt: result.certifiedAt,
                      storyHash: result.storyHash ?? '',
                      certifiedByTechnicianId: session?.technicianId ?? '',
                    },
                  }
                : l
            ),
          }),
          { immediate: true }
        );
        toast.success('Story certified and saved');
      } catch (error: unknown) {
        throw error instanceof Error ? error : new Error('Failed to certify and save story');
      } finally {
        setIsCertifyingStory(false);
      }
    },
    [applyROUpdate, flushPendingSave, roRef, session?.technicianId]
  );

  const acknowledgeStoryBaseline = useCallback((lineId: string, text: string) => {
    setLastGeneratedStoryByLine((prev) => ({ ...prev, [lineId]: text }));
  }, []);

  const clearCdkSanitizedNotice = useCallback((lineId: string) => {
    setCdkSanitizedByLine((prev) => {
      if (!prev[lineId]) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }, []);

  const {
    currentLine,
    lastGeneratedStoryForLine,
    cdkSanitizedForLine,
    isGeneratingForLine,
    isScoringForLine,
    isReviewingForLine,
    storyQualityForLine,
    storyReviewForLine,
    storyQualityStaleForLine,
    storyCertificationForLine,
  } = deriveCurrentLineStoryState({
    currentRO,
    currentLineId,
    isGenerating,
    generatingLineId,
    isScoring,
    scoringLineId,
    isReviewing,
    reviewingLineId,
    storyQualityByLine,
    storyReviewByLine,
    storyCertificationByLine,
    lastGeneratedStoryByLine,
    cdkSanitizedByLine,
  });

  const navigateToLine = useCallback(
    async (lineId: string) => {
      await flushPendingSave({ maxWaitMs: 2_500 });
      flushSync(() => {
        setCurrentLineId(lineId);
        setView('line');
      });
    },
    [flushPendingSave]
  );

  const navigateToRO = useCallback(
    async () => {
      await flushPendingSave({ maxWaitMs: 2_500 });
      flushSync(() => {
        setCurrentLineId(null);
        setView('ro');
      });
    },
    [flushPendingSave]
  );

  const mergeCompanionPatch = useCallback(
    (payload: Parameters<typeof applyCompanionROPatch>[1]) => {
      const latest = roRef.current;
      if (!latest || latest.id !== payload.repairOrderId) return;
      const merged = applyCompanionROPatch(latest, payload);
      if (!merged) return;
      const patchedStory = payload.lineId
        ? payload.linePatch?.warrantyStory?.trim()
        : undefined;
      flushSync(() => {
        if (payload.lineId && patchedStory) {
          setLastGeneratedStoryByLine((prev) => ({ ...prev, [payload.lineId!]: patchedStory }));
        }
        roRef.current = merged;
        setCurrentRO(merged);
        setAllROs((prev) =>
          prev.map((r) => (r.id === merged.id ? repairOrderToSummary(merged) : r))
        );
        bumpCompanionRevision();
      });
    },
    [bumpCompanionRevision, setAllROs]
  );

  const applyCompanionStoryQuality = useCallback(
    (lineId: string, quality: StoryQualityResult) => {
      const latest = roRef.current;
      if (!latest) return;

      const merged = {
        ...latest,
        repairLines: latest.repairLines.map((line) =>
          line.id === lineId ? { ...line, storyQualityAudit: quality } : line
        ),
      };

      flushSync(() => {
        setStoryQualityByLine((prev) => ({ ...prev, [lineId]: quality }));
        roRef.current = merged;
        setCurrentRO(merged);
        setAllROs((prev) =>
          prev.map((r) => (r.id === merged.id ? repairOrderToSummary(merged) : r))
        );
        bumpCompanionRevision();
      });
    },
    [bumpCompanionRevision, setAllROs]
  );

  const applyCompanionCertification = useCallback(
    (
      lineId: string,
      payload: { certifiedByName: string; certifiedAt: string; warrantyStory: string; storyHash?: string }
    ) => {
      const certifiedStory = payload.warrantyStory.trim();
      const latest = roRef.current;
      if (!latest) return;

      const merged = {
        ...latest,
        repairLines: latest.repairLines.map((line) =>
          line.id === lineId
            ? {
                ...line,
                warrantyStory: certifiedStory,
                storyCertification: {
                  certifiedByName: payload.certifiedByName,
                  certifiedAt: payload.certifiedAt,
                  storyHash: payload.storyHash ?? '',
                  certifiedByTechnicianId: session?.technicianId ?? '',
                },
              }
            : line
        ),
      };

      flushSync(() => {
        setStoryCertificationByLine((prev) => ({
          ...prev,
          [lineId]: {
            certifiedByName: payload.certifiedByName,
            certifiedAt: payload.certifiedAt,
            storyText: certifiedStory,
          },
        }));
        roRef.current = merged;
        setCurrentRO(merged);
        setAllROs((prev) =>
          prev.map((r) => (r.id === merged.id ? repairOrderToSummary(merged) : r))
        );
        bumpCompanionRevision();
      });
    },
    [bumpCompanionRevision, session?.technicianId, setAllROs]
  );

  return {
    view,
    setView: navigateView,
    currentRO,
    setCurrentRO,
    currentLineId,
    setCurrentLineId,
    currentLine,
    allROs,
    loading,
    listError,
    listRetrying,
    retryListLoad,
    refreshList,
    searchTerm,
    setSearchTerm,
    pendingROImages,
    setPendingROImages,
    isGenerating,
    isGeneratingForLine,
    isScoringForLine,
    isReviewingForLine,
    storyQualityForLine,
    storyReviewForLine,
    storyQualityStaleForLine,
    storyCertificationForLine,
    isCertifyingStory,
    lastGeneratedStoryForLine,
    cdkSanitizedForLine,
    clearCdkSanitizedNotice,
    openingROId,
    todayROs,
    searchROs,
    searchLoading,
    previousROs,
    previousExpanded,
    togglePreviousExpanded,
    previousLoading,
    previousLoadingMore,
    previousHasMore,
    loadMorePrevious,
    flushPendingSave,
    navigateToLine,
    navigateToRO,
    deleteRO,
    openRO,
    openROById,
    scanRO,
    addScanPagesFromGallery,
    processPendingScan,
    clearPendingScan,
    cancelScan,
    removePendingScanPage,
    createManualRO,
    updateLine,
    updateVehicle,
    updateCustomer,
    addComplaint,
    removeComplaint,
    editComplaint,
    updateRONumber,
    decodeVinForRO,
    addRepairLine,
    buildXentrySection,
    deleteLineXentryImage,
    deleteROXentryImage,
    applyCustomerPayTemplate,
    clearCustomerPayMode,
    generateStory,
    scoreStory,
    reviewStory,
    certifyAndSaveStory,
    acknowledgeStoryBaseline,
    mergeCompanionPatch,
    applyCompanionStoryQuality,
    applyCompanionCertification,
    ensureRepairOrderOpen,
    syncCompanionRepairOrderSnapshot,
    companionRevision,
  };
}