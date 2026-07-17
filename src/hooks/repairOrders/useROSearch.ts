'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { clientLog } from '@/lib/clientLog';
import { isRequestAborted } from '@/lib/requestAbort';
import type { RepairOrderSummary, TechnicianSession } from '@/types';
import {
  matchesROSearch,
  mergeRepairOrders,
  SEARCH_PAGE_SIZE,
  sortRepairOrdersNewestFirst,
} from '@/hooks/repairOrders/roListUtils';

interface UseROSearchOptions {
  session: TechnicianSession | null;
  allROs: RepairOrderSummary[];
  setAllROs: Dispatch<SetStateAction<RepairOrderSummary[]>>;
  setTodayStartIso: Dispatch<SetStateAction<string | null>>;
}

/** Server-backed RO search with client VIN/make/model filtering on loaded rows. */
export function useROSearch({
  session,
  allROs,
  setAllROs,
  setTodayStartIso,
}: UseROSearchOptions) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  /** Monotonic sequence so slower older responses never overwrite newer results. */
  const searchSeqRef = useRef(0);

  useEffect(() => {
    const q = searchTerm.trim();
    if (!session || !q) {
      setSearchLoading(false);
      return;
    }

    const seq = ++searchSeqRef.current;
    const controller = new AbortController();
    setSearchLoading(true);

    const timer = setTimeout(() => {
      api
        .listRepairOrders({ q, limit: SEARCH_PAGE_SIZE }, { signal: controller.signal })
        .then(({ repairOrders, todayStart }) => {
          if (seq !== searchSeqRef.current) return;
          setAllROs((prev) => mergeRepairOrders(prev, repairOrders));
          if (todayStart) setTodayStartIso(todayStart);
        })
        .catch((error: unknown) => {
          if (seq !== searchSeqRef.current) return;
          if (isRequestAborted(error) || controller.signal.aborted) return;
          if (error instanceof ApiError && error.status === 401) return;
          clientLog.warn('Repair order search failed', error);
          toast.message('Search failed — try again');
        })
        .finally(() => {
          if (seq === searchSeqRef.current) setSearchLoading(false);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm, session, setAllROs, setTodayStartIso]);

  const searchROs = useMemo(() => {
    const q = searchTerm.trim();
    if (!q) return [];
    return sortRepairOrdersNewestFirst(allROs.filter((ro) => matchesROSearch(ro, q)));
  }, [allROs, searchTerm]);

  return {
    searchTerm,
    setSearchTerm,
    searchLoading,
    searchROs,
  };
}
