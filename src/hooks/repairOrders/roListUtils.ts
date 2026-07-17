import { isRepairOrderActiveToday } from '@/lib/dealershipDayBoundary';
import type { RepairOrderSummary } from '@/types';

export const PREVIOUS_PAGE_SIZE = 25;
export const SEARCH_PAGE_SIZE = 50;

export function mergeRepairOrders(...lists: RepairOrderSummary[][]): RepairOrderSummary[] {
  const map = new Map<string, RepairOrderSummary>();
  for (const list of lists) {
    for (const ro of list) {
      map.set(ro.id, ro);
    }
  }
  return Array.from(map.values());
}

export function matchesROSearch(ro: RepairOrderSummary, term: string): boolean {
  const q = term.toLowerCase();
  return (
    ro.roNumber.toLowerCase().includes(q) ||
    (ro.vehicle.make?.toLowerCase().includes(q) ?? false) ||
    (ro.vehicle.model?.toLowerCase().includes(q) ?? false) ||
    (ro.vehicle.year?.includes(q) ?? false)
  );
}

export function sortRepairOrdersNewestFirst(orders: RepairOrderSummary[]): RepairOrderSummary[] {
  return [...orders].sort((a, b) =>
    (b.updatedAt || b.createdAt || '0') > (a.updatedAt || a.createdAt || '0') ? 1 : -1
  );
}

export function filterTodayRepairOrders(
  orders: RepairOrderSummary[],
  todayStartIso: string | null
): RepairOrderSummary[] {
  const active = todayStartIso
    ? orders.filter((ro) => isRepairOrderActiveToday(ro.updatedAt, todayStartIso, ro.createdAt))
    : orders;
  return sortRepairOrdersNewestFirst(active);
}