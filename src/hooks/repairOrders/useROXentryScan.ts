'use client';

import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import { analyzeXentryImage } from '@/hooks/repairOrders/roXentryAnalysis';
import {
  isXentryAnalysisFailure,
  xentryAnalysisFailureDetail,
} from '@/hooks/repairOrders/xentryToastHelpers';
import {
  type VisionPipelineControls,
  type VisionPipelineId,
  visionPipelineBlockedMessage,
} from '@/hooks/visionPipeline';
import { clientLog } from '@/lib/clientLog';
import { MI_PRODUCT_LABEL } from '@/lib/grokModels';
import { isRequestAborted } from '@/lib/requestAbort';
import { xentryImageNeedsAnalysis } from '@/lib/xentryAnalysisState';
import { warmupOcrWorker } from '@/services/ocr';
import {
  appendXentryImage,
  applyXentrySnapshot,
  readXentryBaseline,
  targetKey,
  type XentryTarget,
} from '@/hooks/repairOrders/xentryDataModel';
import type { ImageAttachment, PendingImage, RepairOrder } from '@/types';
import { mergeExtracted } from '@/utils/diagnosticParser';
import { openImageFilePicker } from '@/utils/imageFilePicker';
import { normalizeScanFiles } from '@/utils/scanFileHelpers';
import { fetchImageAttachmentAsFile, uploadFileAsAttachment } from '@/utils/uploadHelpers';

export type { XentryTarget } from '@/hooks/repairOrders/xentryDataModel';

interface UseROXentryScanOptions {
  roRef: MutableRefObject<RepairOrder | null>;
  flushPendingSave: (options?: { maxWaitMs?: number }) => Promise<void>;
  saveROImmediate: (
    ro: RepairOrder | null,
    options?: { throwOnError?: boolean }
  ) => Promise<void>;
  xentryInFlightRef: MutableRefObject<boolean>;
  xentryPipeline: VisionPipelineControls;
  getActivePipeline: () => VisionPipelineId | null;
  /** In-memory RO sync for batch UI — no PUT until batch completes (H2). */
  syncROView: (ro: RepairOrder) => void;
}

/** Queue-and-process workflow for line / RO diagnostic (Xentry) photos — mirrors RO scan UX. */
export function useROXentryScan({
  roRef,
  flushPendingSave,
  saveROImmediate,
  xentryInFlightRef,
  xentryPipeline,
  getActivePipeline,
  syncROView,
}: UseROXentryScanOptions) {
  const [pendingByKey, setPendingByKey] = useState<Record<string, PendingImage[]>>({});
  const sessionRef = useRef(0);
  const cancelledRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** Session cache for on-device OCR when the original File is no longer in pending state. */
  const fileCacheRef = useRef<Map<string, File>>(new Map());
  /** Pending IDs the user deleted while upload was still running — skip RO persist if upload completes late. */
  const discardedPendingIdsRef = useRef<Set<string>>(new Set());
  /** Serialize auto-save merges per line/RO so parallel uploads cannot overwrite prior photos. */
  const persistChainByKeyRef = useRef<Map<string, Promise<void>>>(new Map());

  const clearPendingPreviews = useCallback((images: PendingImage[]) => {
    images.forEach((img) => {
      if (img.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(img.previewUrl);
      }
    });
  }, []);

  const getPendingImages = useCallback(
    (target: XentryTarget) => pendingByKey[targetKey(target)] ?? [],
    [pendingByKey]
  );

  const removePendingAfterSave = useCallback(
    (key: string, pendingId: string) => {
      setPendingByKey((prev) => {
        const list = prev[key] ?? [];
        const img = list.find((p) => p.id === pendingId);
        if (img) clearPendingPreviews([img]);
        const nextList = list.filter((p) => p.id !== pendingId);
        if (nextList.length === 0) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: nextList };
      });
    },
    [clearPendingPreviews]
  );

  const enqueuePersistAutoSavedImage = useCallback(
    (
      target: XentryTarget,
      attachment: ImageAttachment,
      file: File,
      pendingId: string
    ): Promise<void> => {
      const key = targetKey(target);

      const runPersist = async (): Promise<void> => {
        if (discardedPendingIdsRef.current.has(pendingId)) {
          discardedPendingIdsRef.current.delete(pendingId);
          return;
        }

        const ro = roRef.current;
        if (!ro) {
          throw new Error('Repair order not loaded — go back and reopen the line.');
        }

        const persisted = appendXentryImage(ro, target, attachment);
        syncROView(persisted);
        await saveROImmediate(persisted, { throwOnError: true });
        fileCacheRef.current.set(attachment.id, file);
        removePendingAfterSave(key, pendingId);
      };

      const previous = persistChainByKeyRef.current.get(key) ?? Promise.resolve();
      const next = previous.then(runPersist, runPersist);

      persistChainByKeyRef.current.set(key, next);
      void next.finally(() => {
        if (persistChainByKeyRef.current.get(key) === next) {
          persistChainByKeyRef.current.delete(key);
        }
      });
      return next;
    },
    [removePendingAfterSave, roRef, saveROImmediate, syncROView]
  );

  const uploadAndSavePending = useCallback(
    async (target: XentryTarget, pendingId: string, file: File) => {
      const key = targetKey(target);
      try {
        const attachment = await uploadFileAsAttachment(file, 'ximg');
        if (discardedPendingIdsRef.current.has(pendingId)) {
          discardedPendingIdsRef.current.delete(pendingId);
          return;
        }
        setPendingByKey((prev) => ({
          ...prev,
          [key]: (prev[key] ?? []).map((img) =>
            img.id === pendingId
              ? { ...img, attachment, uploadStatus: 'saved' as const, file: undefined }
              : img
          ),
        }));
        await enqueuePersistAutoSavedImage(target, attachment, file, pendingId);
      } catch (error) {
        if (discardedPendingIdsRef.current.has(pendingId)) {
          discardedPendingIdsRef.current.delete(pendingId);
          return;
        }
        setPendingByKey((prev) => ({
          ...prev,
          [key]: (prev[key] ?? []).map((img) =>
            img.id === pendingId ? { ...img, uploadStatus: 'error' as const } : img
          ),
        }));
        clientLog.error('xentry.auto_save_failed', error);
        toast.error(
          error instanceof Error ? error.message : 'Photo upload failed — delete and try again.'
        );
      }
    },
    [enqueuePersistAutoSavedImage]
  );

  const appendPendingImages = useCallback(
    async (target: XentryTarget, rawFiles: File[]) => {
      if (rawFiles.length === 0) return;
      if (xentryInFlightRef.current || getActivePipeline() === 'ro_scan') {
        const blocker = getActivePipeline();
        toast.message(
          blocker ? visionPipelineBlockedMessage(blocker) : 'Diagnostic processing already in progress…'
        );
        return;
      }

      if (!roRef.current) {
        toast.error('Repair order not loaded — go back and reopen the line.');
        return;
      }

      try {
        const normalizedFiles = await normalizeScanFiles(rawFiles);
        if (normalizedFiles.length === 0) {
          toast.error('No supported images were selected.');
          return;
        }

        const key = targetKey(target);
        let newImages: PendingImage[] = [];
        setPendingByKey((prev) => {
          const baseIndex = prev[key]?.length ?? 0;
          newImages = normalizedFiles.map((file, i) => ({
            id: `ximg-pending-${Date.now()}-${baseIndex + i}`,
            previewUrl: URL.createObjectURL(file),
            name: file.name || `diagnostic-${baseIndex + i + 1}.jpg`,
            file,
            uploadStatus: 'uploading' as const,
          }));
          return {
            ...prev,
            [key]: [...(prev[key] ?? []), ...newImages],
          };
        });

        toast.success(
          `Saving ${newImages.length} diagnostic photo${newImages.length === 1 ? '' : 's'}…`
        );

        for (const img of newImages) {
          if (img.file) {
            void uploadAndSavePending(target, img.id, img.file);
          }
        }
      } catch (error) {
        clientLog.error('xentry.file_prepare_failed', error);
        toast.error(error instanceof Error ? error.message : 'Could not prepare diagnostic photos.');
      }
    },
    [getActivePipeline, roRef, uploadAndSavePending, xentryInFlightRef]
  );

  const capturePhoto = useCallback(
    (target: XentryTarget) => {
      if (xentryInFlightRef.current || getActivePipeline() === 'ro_scan') {
        const blocker = getActivePipeline();
        toast.message(
          blocker ? visionPipelineBlockedMessage(blocker) : 'Diagnostic processing already in progress…'
        );
        return;
      }

      openImageFilePicker({
        capture: true,
        multiple: false,
        onFiles: (files) => {
          void appendPendingImages(target, files);
        },
      });
    },
    [appendPendingImages, getActivePipeline, xentryInFlightRef]
  );

  const addFromGallery = useCallback(
    (target: XentryTarget) => {
      if (xentryInFlightRef.current || getActivePipeline() === 'ro_scan') {
        const blocker = getActivePipeline();
        toast.message(
          blocker ? visionPipelineBlockedMessage(blocker) : 'Diagnostic processing already in progress…'
        );
        return;
      }

      openImageFilePicker({
        multiple: true,
        onFiles: (files) => {
          void appendPendingImages(target, files);
        },
      });
    },
    [appendPendingImages, getActivePipeline, xentryInFlightRef]
  );

  const removePendingImage = useCallback(
    (target: XentryTarget, imageId: string) => {
      const key = targetKey(target);
      const pending = pendingByKey[key] ?? [];
      const img = pending.find((p) => p.id === imageId);
      if (!img) return;

      if (img.uploadStatus === 'uploading') {
        discardedPendingIdsRef.current.add(imageId);
      }

      clearPendingPreviews([img]);
      setPendingByKey((prev) => {
        const list = prev[key] ?? [];
        const nextList = list.filter((p) => p.id !== imageId);
        if (nextList.length === 0) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: nextList };
      });
      toast.message('Queued photo removed');
    },
    [clearPendingPreviews, pendingByKey]
  );

  const clearPending = useCallback(
    (target: XentryTarget) => {
      const key = targetKey(target);
      const pending = pendingByKey[key] ?? [];
      if (pending.length === 0) return;
      pending.forEach((img) => {
        if (img.uploadStatus === 'uploading') {
          discardedPendingIdsRef.current.add(img.id);
        }
      });
      clearPendingPreviews(pending);
      setPendingByKey((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.message('Queued diagnostic photos cleared');
    },
    [clearPendingPreviews, pendingByKey]
  );

  const cancelProcessing = useCallback(() => {
    sessionRef.current += 1;
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    xentryInFlightRef.current = false;
    xentryPipeline.finish();
    // L5: match RO scan cancel — abort in-flight work and clear all queued diagnostic photos.
    setPendingByKey((prev) => {
      Object.values(prev).forEach((images) => {
        images.forEach((img) => {
          if (img.uploadStatus === 'uploading') {
            discardedPendingIdsRef.current.add(img.id);
          }
        });
        clearPendingPreviews(images);
      });
      return {};
    });
    toast.message('Diagnostic processing cancelled');
  }, [clearPendingPreviews, xentryInFlightRef, xentryPipeline]);

  const toastProcessResult = useCallback((fileCount: number, ocrTexts: string[]) => {
    const failedTexts = ocrTexts.filter(isXentryAnalysisFailure);
    const failed = failedTexts.length;
    if (failed === fileCount) {
      const firstFailure = failedTexts[0];
      toast.error(firstFailure ? xentryAnalysisFailureDetail(firstFailure) : 'Diagnostic analysis failed.');
      return;
    }
    if (failed > 0) {
      toast.warning(
        `${fileCount - failed} photo${fileCount - failed === 1 ? '' : 's'} analyzed; ${failed} need a retake or sharper image.`
      );
      return;
    }
    toast.success(
      `${fileCount} diagnostic photo${fileCount === 1 ? '' : 's'} processed — tap Generate ${MI_PRODUCT_LABEL} to use extracted data.`
    );
  }, []);

  const resolveAnalysisFile = useCallback(
    async (attachment: ImageAttachment): Promise<File> => {
      const cached = fileCacheRef.current.get(attachment.id);
      if (cached) return cached;
      const fetched = await fetchImageAttachmentAsFile(attachment);
      fileCacheRef.current.set(attachment.id, fetched);
      return fetched;
    },
    []
  );

  const processPending = useCallback(
    async (target: XentryTarget) => {
      const key = targetKey(target);
      const pending = pendingByKey[key] ?? [];
      const stillUploading = pending.some((img) => img.uploadStatus === 'uploading');
      if (stillUploading) {
        toast.message('Wait for photos to finish saving before processing.');
        return;
      }
      if (xentryInFlightRef.current) {
        toast.message('Diagnostic processing already in progress…');
        return;
      }
      if (!xentryPipeline.tryAcquire()) {
        const blocker = getActivePipeline();
        if (blocker) toast.message(visionPipelineBlockedMessage(blocker));
        return;
      }

      const sessionId = ++sessionRef.current;
      const isActive = () => sessionRef.current === sessionId && !cancelledRef.current;

      cancelledRef.current = false;
      xentryInFlightRef.current = true;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        await flushPendingSave({ maxWaitMs: 2_500 });
        if (!isActive()) return;

        const ro = roRef.current;
        if (!ro) {
          throw new Error('Repair order not loaded — go back and reopen the line.');
        }

        const baseline = readXentryBaseline(ro, target);
        const indicesToAnalyze = baseline.images
          .map((img, index) => ({ img, index }))
          .filter(({ index }) => xentryImageNeedsAnalysis(baseline.ocrTexts, index));

        if (indicesToAnalyze.length === 0) {
          toast.message('Add at least one diagnostic photo before processing.');
          return;
        }

        const allImages = [...baseline.images];
        let updatedOcrTexts = [...baseline.ocrTexts];
        let updatedExtracted = baseline.extracted;

        syncROView(
          applyXentrySnapshot(ro, target, allImages, updatedOcrTexts, updatedExtracted)
        );
        if (!isActive()) return;

        xentryPipeline.start('Running AI vision extraction…');
        xentryPipeline.setProgress(12);
        xentryPipeline.setStatusMessage(
          `Analyzing ${indicesToAnalyze.length} diagnostic photo${indicesToAnalyze.length === 1 ? '' : 's'}…`
        );
        void warmupOcrWorker().catch((error) => {
          clientLog.warn('xentry.ocr_warmup_failed', error);
        });

        // Limited concurrency (2) — serial was multi-minute for multi-photo jobs.
        const XENTRY_ANALYSIS_CONCURRENCY = 2;
        let completedPasses = 0;
        const progressByPass = new Array(indicesToAnalyze.length).fill(0);

        // Mark all as analyzing up front for UI feedback
        updatedOcrTexts = updatedOcrTexts.map((text, idx) =>
          indicesToAnalyze.some((item) => item.index === idx)
            ? '[Analyzing diagnostic photo…]'
            : text
        );
        {
          const progressRo = roRef.current;
          if (progressRo) {
            syncROView(
              applyXentrySnapshot(progressRo, target, allImages, updatedOcrTexts, updatedExtracted)
            );
          }
        }

        const analyzeOne = async (pass: number) => {
          if (!isActive()) return;
          const { img: attachment, index: ocrIndex } = indicesToAnalyze[pass]!;
          const file = await resolveAnalysisFile(attachment);

          xentryPipeline.setStatusMessage(
            `Analyzing photo ${Math.min(completedPasses + 1, indicesToAnalyze.length)} of ${indicesToAnalyze.length} (fault codes, measurements, guided tests)…`
          );

          try {
            const result = await analyzeXentryImage(
              file,
              attachment,
              (p) => {
                if (!isActive()) return;
                progressByPass[pass] = p / 100;
                const avg =
                  progressByPass.reduce((a, b) => a + b, 0) / indicesToAnalyze.length;
                xentryPipeline.setProgress(Math.round(12 + avg * 82));
              },
              { signal: abortController.signal }
            );
            if (!isActive()) return;

            updatedExtracted = mergeExtracted(updatedExtracted, result.extracted);
            updatedOcrTexts = updatedOcrTexts.map((text, idx) =>
              idx === ocrIndex ? result.text : text
            );
          } catch (err) {
            if (isRequestAborted(err) || !isActive()) return;
            clientLog.warn('xentry.analysis_failed', err);
            updatedOcrTexts = updatedOcrTexts.map((text, idx) =>
              idx === ocrIndex ? '[Analysis failed for this image]' : text
            );
          } finally {
            completedPasses += 1;
            progressByPass[pass] = 1;
            if (isActive()) {
              const midRo = roRef.current;
              if (midRo) {
                syncROView(
                  applyXentrySnapshot(midRo, target, allImages, updatedOcrTexts, updatedExtracted)
                );
              }
            }
          }
        };

        let nextPass = 0;
        const workers = Array.from(
          { length: Math.min(XENTRY_ANALYSIS_CONCURRENCY, indicesToAnalyze.length) },
          async () => {
            while (isActive() && nextPass < indicesToAnalyze.length) {
              const pass = nextPass++;
              await analyzeOne(pass);
            }
          }
        );
        await Promise.all(workers);

        if (!isActive()) return;

        const finalRo = roRef.current;
        if (!finalRo) {
          throw new Error('Repair order not loaded — go back and reopen the line.');
        }
        const persisted = applyXentrySnapshot(
          finalRo,
          target,
          allImages,
          updatedOcrTexts,
          updatedExtracted
        );
        await saveROImmediate(persisted, { throwOnError: true });
        if (!isActive()) return;

        xentryPipeline.setProgress(100);
        xentryPipeline.setStatusMessage('Diagnostic extraction complete');

        const analyzedTexts = indicesToAnalyze.map(({ index }) => updatedOcrTexts[index] ?? '');
        toastProcessResult(indicesToAnalyze.length, analyzedTexts);
      } catch (error) {
        if (!isActive() || isRequestAborted(error)) return;
        clientLog.error('xentry.process_failed', error);
        toast.error(error instanceof Error ? error.message : 'Failed to process diagnostic photos');
      } finally {
        abortControllerRef.current = null;
        if (sessionRef.current === sessionId) {
          xentryInFlightRef.current = false;
          xentryPipeline.finish();
        }
      }
    },
    [
      flushPendingSave,
      getActivePipeline,
      pendingByKey,
      resolveAnalysisFile,
      roRef,
      saveROImmediate,
      syncROView,
      toastProcessResult,
      xentryInFlightRef,
      xentryPipeline,
    ]
  );

  return {
    getPendingImages,
    capturePhoto,
    addFromGallery,
    processPending,
    clearPending,
    cancelProcessing,
    removePendingImage,
  };
};