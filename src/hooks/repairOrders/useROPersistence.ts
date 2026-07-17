'use client';

import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { debounce } from '@/lib/debounce';
import { mergePersistedWithClient } from '@/lib/repairOrderMerge';
import {
  awaitRepairOrderSaveQueue,
  awaitRepairOrderSaveQueueWithTimeout,
  enqueueRepairOrderSave,
  isRepairOrderSaveQueueBusy,
} from '@/lib/repairOrderSaveQueue';
import { promptSaveConflictChoice } from '@/lib/saveConflictUx';
import { cloneRepairOrderForUpdate } from '@/utils/cloneRepairOrder';
import { repairOrderToSummary } from '@/utils/repairOrderSummary';
import type { RepairLine, RepairOrder, RepairOrderSummary } from '@/types';
import { ensureComplaintIds } from '@/utils/repairOrderFactory';

/** @deprecated use mergePersistedWithClient — kept for tests/call sites. */
export function preserveClientWarrantyStories(
  persisted: RepairOrder,
  client: RepairOrder | null
): RepairOrder {
  return mergePersistedWithClient(persisted, client);
}

/** @deprecated use mergePersistedWithClient */
export function preserveClientXentryMedia(
  persisted: RepairOrder,
  client: RepairOrder | null
): RepairOrder {
  return mergePersistedWithClient(persisted, client);
}

const DEFAULT_FLUSH_MAX_WAIT_MS = 5_000;

const LIGHT_LINE_KEYS = new Set([
  'description',
  'customerConcern',
  'technicianNotes',
  'warrantyStory',
]);

export function isLightLinePatch(updates: Partial<RepairLine>): boolean {
  const keys = Object.keys(updates);
  if (keys.length === 0) return false;
  return keys.every((k) => LIGHT_LINE_KEYS.has(k));
}

/** M21: persistence, debounced save, per-RO queue, and light line PATCH path. */
export function useROPersistence(
  allROs: RepairOrderSummary[],
  setAllROs: Dispatch<SetStateAction<RepairOrderSummary[]>>,
  roRef: MutableRefObject<RepairOrder | null>,
  setCurrentRO: Dispatch<SetStateAction<RepairOrder | null>>
) {
  const clientRevisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const lastSavedRevisionRef = useRef(0);

  const allROsRef = useRef(allROs);
  allROsRef.current = allROs;

  /** Accumulated light field patches per lineId — flushed via PATCH not full PUT. */
  const pendingLinePatchesRef = useRef<Map<string, Partial<RepairLine>>>(new Map());

  const saveROImmediateRef = useRef<
    (ro: RepairOrder | null, options?: { throwOnError?: boolean }) => Promise<void>
  >(async () => undefined);

  const applySavedRo = useCallback(
    (saved: RepairOrder) => {
      roRef.current = saved;
      setCurrentRO(saved);
      setAllROs((prev) => {
        const summary = repairOrderToSummary(saved);
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = summary;
          return copy;
        }
        return [summary, ...prev];
      });
    },
    [roRef, setAllROs, setCurrentRO]
  );

  const persistRO = useCallback(
    async (ro: RepairOrder): Promise<RepairOrder> => {
      return enqueueRepairOrderSave(ro.id, async () => {
        const payload = roRef.current?.id === ro.id ? roRef.current : ro;
        const list = allROsRef.current;
        const isNew = !list.some((r) => r.id === payload.id) || payload.id.startsWith('ro-');
        if (isNew && payload.id.startsWith('ro-')) {
          const { repairOrder } = await api.createRepairOrder(payload, {
            idempotencyKey: `create-${payload.id}`.slice(0, 128),
          });
          setAllROs((prev) => [
            repairOrderToSummary(repairOrder),
            ...prev.filter((r) => r.id !== payload.id),
          ]);
          return repairOrder;
        }
        const { repairOrder } = await api.updateRepairOrder(payload.id, payload);
        setAllROs((prev) =>
          prev.map((r) => (r.id === repairOrder.id ? repairOrderToSummary(repairOrder) : r))
        );
        return repairOrder;
      });
    },
    [roRef, setAllROs]
  );

  const resolveConflictAndRetry = useCallback(
    async (
      local: RepairOrder
    ): Promise<{ repairOrder: RepairOrder; fullyApplied: boolean }> => {
      const { repairOrder: remote } = await api.getRepairOrder(local.id);
      const choice = await promptSaveConflictChoice();

      if (choice === 'use-server') {
        const serverCopy = ensureComplaintIds(remote);
        applySavedRo(serverCopy);
        dirtyRef.current = false;
        lastSavedRevisionRef.current = clientRevisionRef.current;
        pendingLinePatchesRef.current.clear();
        toast.message('Loaded server version — your device edits were replaced');
        return { repairOrder: serverCopy, fullyApplied: true };
      }

      const merged = mergePersistedWithClient(remote, roRef.current ?? local);
      const withToken = { ...merged, updatedAt: remote.updatedAt };
      roRef.current = withToken;
      setCurrentRO(withToken);
      const { repairOrder } = await api.updateRepairOrder(withToken.id, withToken);
      toast.success('Kept your edits and saved');
      return { repairOrder, fullyApplied: false };
    },
    [applySavedRo, roRef, setCurrentRO]
  );

  const flushLinePatches = useCallback(async (): Promise<void> => {
    const ro = roRef.current;
    if (!ro) {
      pendingLinePatchesRef.current.clear();
      return;
    }
    if (ro.id.startsWith('ro-')) {
      // Not server-backed yet — fall through to full create/save
      pendingLinePatchesRef.current.clear();
      await saveROImmediateRef.current(ro);
      return;
    }

    const entries = [...pendingLinePatchesRef.current.entries()];
    if (entries.length === 0) return;
    pendingLinePatchesRef.current.clear();

    await enqueueRepairOrderSave(ro.id, async () => {
      let latest = roRef.current;
      if (!latest || latest.id !== ro.id) return;

      for (const [lineId, fields] of entries) {
        const line = latest.repairLines.find((l) => l.id === lineId);
        if (!line) continue;
        const body: {
          description?: string;
          customerConcern?: string;
          technicianNotes?: string;
          warrantyStory?: string;
          updatedAt?: string;
        } = { updatedAt: latest.updatedAt };
        if (fields.description !== undefined) body.description = line.description;
        if (fields.customerConcern !== undefined) body.customerConcern = line.customerConcern;
        if (fields.technicianNotes !== undefined) body.technicianNotes = line.technicianNotes;
        if (fields.warrantyStory !== undefined) body.warrantyStory = line.warrantyStory;

        try {
          const { line: patched, updatedAt } = await api.patchRepairLine(latest.id, lineId, body);
          latest = {
            ...latest,
            updatedAt,
            repairLines: latest.repairLines.map((l) =>
              l.id === lineId
                ? {
                    ...l,
                    description: patched.description ?? l.description,
                    customerConcern: patched.customerConcern ?? l.customerConcern,
                    technicianNotes: patched.technicianNotes ?? l.technicianNotes,
                    warrantyStory: patched.warrantyStory ?? l.warrantyStory,
                  }
                : l
            ),
          };
          roRef.current = latest;
          setCurrentRO(latest);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            // Escalate to full conflict UX via full PUT path
            pendingLinePatchesRef.current.set(lineId, fields);
            throw e;
          }
          throw e;
        }
      }
    });
  }, [roRef, setCurrentRO]);

  const flushLinePatchesRef = useRef(flushLinePatches);
  flushLinePatchesRef.current = flushLinePatches;

  const debouncedLinePatchRef = useRef(
    debounce(() => {
      void flushLinePatchesRef.current().catch((e) => {
        if (e instanceof ApiError && e.status === 409) {
          const ro = roRef.current;
          if (ro) void saveROImmediateRef.current(ro);
          return;
        }
        toast.error(e instanceof Error ? e.message : 'Failed to save line changes');
      });
    }, 450)
  );

  const scheduleLinePatch = useCallback(
    (lineId: string, fields: Partial<RepairLine>, options?: { immediate?: boolean }) => {
      const prev = pendingLinePatchesRef.current.get(lineId) || {};
      pendingLinePatchesRef.current.set(lineId, { ...prev, ...fields });
      dirtyRef.current = true;
      clientRevisionRef.current += 1;
      if (options?.immediate) {
        debouncedLinePatchRef.current.cancel();
        void flushLinePatchesRef.current().catch((e) => {
          if (e instanceof ApiError && e.status === 409) {
            const ro = roRef.current;
            if (ro) void saveROImmediateRef.current(ro);
            return;
          }
          toast.error(e instanceof Error ? e.message : 'Failed to save line changes');
        });
      } else {
        debouncedLinePatchRef.current();
      }
    },
    [roRef]
  );

  const saveROImmediate = useCallback(
    async (ro: RepairOrder | null, options?: { throwOnError?: boolean }) => {
      if (ro) {
        const revisionAtStart = clientRevisionRef.current;
        // Coalesce pending light patches into this full save
        pendingLinePatchesRef.current.clear();
        debouncedLinePatchRef.current.cancel();
        try {
          let persisted: RepairOrder;
          try {
            persisted = await persistRO(ro);
          } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
              try {
                const resolved = await resolveConflictAndRetry(
                  roRef.current?.id === ro.id ? roRef.current! : ro
                );
                if (resolved.fullyApplied) {
                  return;
                }
                persisted = resolved.repairOrder;
              } catch (retryError) {
                toast.error(
                  retryError instanceof Error
                    ? retryError.message
                    : 'Could not resolve save conflict — reopen the RO'
                );
                if (options?.throwOnError) throw retryError;
                return;
              }
            } else {
              throw e;
            }
          }

          let saved = ensureComplaintIds(
            ro.complaintIds && ro.complaintIds.length === persisted.complaints.length
              ? { ...persisted, complaintIds: ro.complaintIds }
              : persisted
          );
          saved = mergePersistedWithClient(saved, roRef.current);

          if (clientRevisionRef.current > revisionAtStart) {
            dirtyRef.current = true;
          } else {
            dirtyRef.current = false;
            lastSavedRevisionRef.current = clientRevisionRef.current;
          }

          applySavedRo(saved);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            toast.error(e.message);
            if (options?.throwOnError) throw e;
            return;
          }
          const message = e instanceof Error ? e.message : 'Failed to save repair order';
          toast.error(message);
          if (options?.throwOnError) {
            throw e instanceof Error ? e : new Error(message);
          }
        }
      } else {
        roRef.current = null;
        setCurrentRO(null);
        dirtyRef.current = false;
        pendingLinePatchesRef.current.clear();
      }
    },
    [applySavedRo, persistRO, resolveConflictAndRetry, roRef, setCurrentRO]
  );

  saveROImmediateRef.current = saveROImmediate;

  const debouncedPersistRef = useRef(
    debounce((ro: RepairOrder) => {
      void saveROImmediateRef.current(ro);
    }, 450)
  );

  const flushPendingSave = useCallback(
    async (options?: { maxWaitMs?: number }) => {
      await debouncedLinePatchRef.current.flush();
      await flushLinePatchesRef.current().catch(() => undefined);
      await debouncedPersistRef.current.flush();
      const maxWaitMs =
        options?.maxWaitMs === undefined ? DEFAULT_FLUSH_MAX_WAIT_MS : options.maxWaitMs;
      const roId = roRef.current?.id;
      if (maxWaitMs && maxWaitMs > 0) {
        const ok = await awaitRepairOrderSaveQueueWithTimeout(maxWaitMs, roId);
        if (!ok) {
          toast.message('Save still in progress — continuing with latest local data');
        }
        return;
      }
      await awaitRepairOrderSaveQueue(roId);
    },
    [roRef]
  );

  const scheduleSaveRO = useCallback((ro: RepairOrder) => {
    debouncedPersistRef.current(ro);
  }, []);

  const applyROUpdate = useCallback(
    (
      updater: (ro: RepairOrder) => RepairOrder,
      options?: {
        immediate?: boolean;
        skipPersist?: boolean;
        /** When set, use light PATCH path instead of full-document PUT. */
        linePatch?: { lineId: string; fields: Partial<RepairLine> };
      }
    ) => {
      const base = roRef.current;
      if (!base) return null;
      const updated = ensureComplaintIds(updater(cloneRepairOrderForUpdate(base)));
      clientRevisionRef.current += 1;
      if (!options?.skipPersist) {
        dirtyRef.current = true;
      }
      roRef.current = updated;
      setCurrentRO(updated);
      setAllROs((prev) =>
        prev.map((r) => (r.id === updated.id ? repairOrderToSummary(updated) : r))
      );
      if (options?.skipPersist) {
        return updated;
      }

      if (options?.linePatch && isLightLinePatch(options.linePatch.fields)) {
        scheduleLinePatch(options.linePatch.lineId, options.linePatch.fields, {
          immediate: options.immediate,
        });
        return updated;
      }

      if (options?.immediate) {
        debouncedPersistRef.current.cancel();
        debouncedLinePatchRef.current.cancel();
        void saveROImmediateRef.current(updated);
      } else {
        scheduleSaveRO(updated);
      }
      return updated;
    },
    [roRef, scheduleLinePatch, scheduleSaveRO, setAllROs, setCurrentRO]
  );

  const cancelPendingSave = useCallback(() => {
    debouncedPersistRef.current.cancel();
    debouncedLinePatchRef.current.cancel();
  }, []);

  const isLocallyDirty = useCallback(() => {
    const roId = roRef.current?.id;
    return (
      dirtyRef.current ||
      pendingLinePatchesRef.current.size > 0 ||
      isRepairOrderSaveQueueBusy(roId)
    );
  }, [roRef]);

  const getClientRevision = useCallback(() => clientRevisionRef.current, []);

  const markCleanFromServer = useCallback(() => {
    dirtyRef.current = false;
    lastSavedRevisionRef.current = clientRevisionRef.current;
    pendingLinePatchesRef.current.clear();
  }, []);

  return {
    persistRO,
    saveROImmediate,
    flushPendingSave,
    cancelPendingSave,
    scheduleSaveRO,
    applyROUpdate,
    scheduleLinePatch,
    debouncedPersistRef,
    isLocallyDirty,
    getClientRevision,
    markCleanFromServer,
  };
}
