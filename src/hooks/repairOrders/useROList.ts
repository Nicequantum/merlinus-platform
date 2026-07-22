'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { networkRetryDelayMs, NETWORK_RETRY_MAX_ATTEMPTS, sleep } from '@/lib/networkErrors';
import { readRoListCache, writeRoListCache } from '@/lib/roListCache';
import type { RepairOrderSummary, TechnicianSession } from '@/types';
import {
  filterTodayRepairOrders,
  mergeRepairOrders,
  PREVIOUS_PAGE_SIZE,
} from '@/hooks/repairOrders/roListUtils';

function isComplianceBlockedError(error: ApiError): boolean {
  return (
    error.status === 403 &&
    (error.message.includes('Legal disclaimer') || error.message.includes('consent'))
  );
}

interface UseROListOptions {
  onComplianceRequired?: () => void;
}

function useStableComplianceCallback(
  callback: (() => void) | undefined
): MutableRefObject<(() => void) | undefined> {
  const ref = useRef(callback);
  ref.current = callback;
  return ref;
}

/** Today + previous pagination for the repair order home lists. */
export function useROList(session: TechnicianSession | null, options: UseROListOptions = {}) {
  const onComplianceRequiredRef = useStableComplianceCallback(options.onComplianceRequired);
  const [allROs, setAllROs] = useState<RepairOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listRetrying, setListRetrying] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [todayStartIso, setTodayStartIso] = useState<string | null>(null);
  const [previousROs, setPreviousROs] = useState<RepairOrderSummary[]>([]);
  const [previousExpanded, setPreviousExpanded] = useState(false);
  const [previousLoading, setPreviousLoading] = useState(false);
  const [previousLoadingMore, setPreviousLoadingMore] = useState(false);
  const [previousCursor, setPreviousCursor] = useState<string | null>(null);
  const [previousHasMore, setPreviousHasMore] = useState(false);
  const previousLoadedRef = useRef(false);

  const refreshList = useCallback(async () => {
    if (!session) {
      setAllROs([]);
      setPreviousROs([]);
      setListError(null);
      setLoading(false);
      setListRetrying(false);
      setIsValidating(false);
      setFromCache(false);
      previousLoadedRef.current = false;
      setPreviousExpanded(false);
      return;
    }

    {
      const isAdvisor =
        session.role === 'service_advisor' ||
        (session.role === 'owner' &&
          session.scopeMode === 'dealership' &&
          session.viewAsRole === 'service_advisor');
      if (isAdvisor) {
        setAllROs([]);
        setPreviousROs([]);
        setListError(null);
        setLoading(false);
        setListRetrying(false);
        setIsValidating(false);
        previousLoadedRef.current = false;
        setPreviousExpanded(false);
        return;
      }
    }

    setListError(null);
    setIsValidating(true);
    let lastError: unknown;
    // Extra application-level retries on top of api.ts network retries — covers
    // cold-start 500s that surface as ApiError after transport succeeded.
    for (let attempt = 0; attempt <= NETWORK_RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const { repairOrders, todayStart } = await api.listRepairOrders({ scope: 'today' });
        setAllROs(repairOrders);
        if (todayStart) setTodayStartIso(todayStart);
        setPreviousROs([]);
        setPreviousCursor(null);
        setPreviousHasMore(false);
        previousLoadedRef.current = false;
        setPreviousExpanded(false);
        setFromCache(false);
        writeRoListCache({
          technicianId: session.technicianId,
          dealershipId: session.dealershipId,
          repairOrders,
          todayStart: todayStart ?? null,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error instanceof ApiError && error.status === 401) {
          setAllROs([]);
          setListError(null);
          lastError = null;
          break;
        }
        if (error instanceof ApiError && isComplianceBlockedError(error)) {
          setAllROs([]);
          setListError(null);
          onComplianceRequiredRef.current?.();
          lastError = null;
          break;
        }
        const retriable =
          !(error instanceof ApiError) ||
          error.status === 408 ||
          error.status === 429 ||
          error.status === 500 ||
          error.status === 502 ||
          error.status === 503 ||
          error.status === 504;
        if (!retriable || attempt === NETWORK_RETRY_MAX_ATTEMPTS) {
          break;
        }
        setListRetrying(true);
        await sleep(networkRetryDelayMs(attempt));
      }
    }
    if (lastError) {
      // Keep cached rows visible; only hard-error when the list is empty.
      setAllROs((current) => {
        if (current.length === 0) {
          setListError('Could not load repair orders. Check your connection and try again.');
        } else {
          setListError(null);
        }
        return current;
      });
      // Do not rethrow — effect-driven loads must not produce unhandled rejections.
    }
    setLoading(false);
    setListRetrying(false);
    setIsValidating(false);
  }, [onComplianceRequiredRef, session]);

  const loadPreviousPage = useCallback(
    async (append: boolean) => {
      if (!session) return;
      if (append) setPreviousLoadingMore(true);
      else setPreviousLoading(true);

      try {
        const { repairOrders, nextCursor, hasMore, todayStart } = await api.listRepairOrders({
          scope: 'previous',
          limit: PREVIOUS_PAGE_SIZE,
          cursor: append ? previousCursor ?? undefined : undefined,
        });
        setPreviousROs((prev) => (append ? mergeRepairOrders(prev, repairOrders) : repairOrders));
        setAllROs((prev) => mergeRepairOrders(prev, repairOrders));
        setPreviousCursor(nextCursor ?? null);
        setPreviousHasMore(Boolean(hasMore));
        if (todayStart) setTodayStartIso(todayStart);
        previousLoadedRef.current = true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return;
        }
        if (error instanceof ApiError && isComplianceBlockedError(error)) {
          onComplianceRequiredRef.current?.();
          return;
        }
        toast.error('Could not load previous repair orders — try again.');
      } finally {
        setPreviousLoading(false);
        setPreviousLoadingMore(false);
      }
    },
    [onComplianceRequiredRef, previousCursor, session]
  );

  const togglePreviousExpanded = useCallback(() => {
    setPreviousExpanded((expanded) => {
      const next = !expanded;
      if (next && !previousLoadedRef.current) {
        void loadPreviousPage(false);
      }
      return next;
    });
  }, [loadPreviousPage]);

  const loadMorePrevious = useCallback(() => {
    if (previousLoading || previousLoadingMore || !previousHasMore) return;
    void loadPreviousPage(true);
  }, [loadPreviousPage, previousHasMore, previousLoading, previousLoadingMore]);

  const retryListLoad = useCallback(async () => {
    setListRetrying(true);
    setLoading(true);
    try {
      await refreshList();
    } catch {
      toast.error('Still unable to load repair orders — check Wi‑Fi or ask your manager.');
    }
  }, [refreshList]);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      setListError(null);
      setAllROs([]);
      setPreviousROs([]);
      setFromCache(false);
      return;
    }

    // Stale-while-revalidate: paint cache instantly, revalidate in background.
    const cached = readRoListCache(session.technicianId, session.dealershipId);
    if (cached && cached.payload.repairOrders.length > 0) {
      setAllROs(cached.payload.repairOrders);
      if (cached.payload.todayStart) setTodayStartIso(cached.payload.todayStart);
      setFromCache(true);
      setLoading(false);
      setListError(null);
    } else {
      setLoading(true);
    }
    void refreshList();
  }, [session, refreshList]);

  const todayROs = useMemo(
    () => filterTodayRepairOrders(allROs, todayStartIso),
    [allROs, todayStartIso]
  );

  return {
    allROs,
    setAllROs,
    loading,
    listError,
    listRetrying,
    /** True while network revalidate is in flight (may already show cached rows). */
    isValidating,
    /** Rows currently shown came from session cache (still revalidating). */
    fromCache,
    retryListLoad,
    refreshList,
    todayStartIso,
    setTodayStartIso,
    previousROs,
    previousExpanded,
    togglePreviousExpanded,
    previousLoading,
    previousLoadingMore,
    previousHasMore,
    loadMorePrevious,
    todayROs,
  };
}