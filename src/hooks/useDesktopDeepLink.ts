'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { parseDesktopDeepLink } from '@/lib/desktopLayoutPrefs';
import type { useRepairOrders } from '@/hooks/useRepairOrders';

type RoApi = ReturnType<typeof useRepairOrders>;

/**
 * Apply ?ro=&line=&view= deep links once after auth shell mounts.
 * Clears query params after apply so refresh does not re-open stale ids.
 */
export function useDesktopDeepLink(ro: RoApi, enabled: boolean) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!enabled || appliedRef.current) return;
    const { roId, lineId, view } = parseDesktopDeepLink(searchParams.toString());
    if (!roId && !view) return;
    appliedRef.current = true;

    void (async () => {
      try {
        if (view === 'home' || view === 'settings' || view === 'videoInspection') {
          ro.setView(view as 'home' | 'settings' | 'videoInspection');
        }
        if (roId) {
          await ro.ensureRepairOrderOpen(roId);
          if (lineId) {
            await ro.navigateToLine(lineId);
          } else if (view === 'ro' || !view) {
            await ro.navigateToRO();
          }
        }
      } finally {
        // Strip deep-link params; keep other query keys if any
        const next = new URLSearchParams(searchParams.toString());
        next.delete('ro');
        next.delete('line');
        next.delete('view');
        next.delete('desktop');
        const q = next.toString();
        router.replace(q ? `${pathname}?${q}` : pathname || '/');
      }
    })();
  }, [enabled, pathname, ro, router, searchParams]);
}
