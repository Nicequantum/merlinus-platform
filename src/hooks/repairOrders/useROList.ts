'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
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
        previousLoadedRef.current = false;
        setPreviousExpanded(false);
        return;
      }
    }

    setListError(null);
    try {
      const { repairOrders, todayStart } = await api.listRepairOrders({ scope: 'today' });
      setAllROs(repairOrders);
      if (todayStart) setTodayStartIso(todayStart);
      setPreviousROs([]);
      setPreviousCursor(null);
      setPreviousHasMore(false);
      previousLoadedRef.current = false;
      setPreviousExpanded(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAllROs([]);
        setListError(null);
        return;
      }
      if (error instanceof ApiError && isComplianceBlockedError(error)) {
        setAllROs([]);
        setListError(null);
        onComplianceRequiredRef.current?.();
        return;
      }
      setListError('Could not load repair orders. Check your connection and try again.');
      // Do not rethrow — effect-driven loads must not produce unhandled rejections.
      // retryListLoad can call refreshList and still see listError.
    } finally {
      setLoading(false);
      setListRetrying(false);
    }
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
      return;
    }

    setLoading(true);
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