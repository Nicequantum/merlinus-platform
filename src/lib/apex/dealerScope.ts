/**
 * APEX NATIONAL PLATFORM — Prisma where/data helpers for dealer scoping.
 * MERLINUS SINGLE-DEALER: no-op when dealerId is missing (dealershipId remains authoritative).
 */

/** Add optional dealerId to a flat Prisma where clause. */
export function withOptionalDealerId<T extends Record<string, unknown>>(
  where: T,
  dealerId: string | null | undefined
): T & { dealerId?: string } {
  if (!dealerId?.trim()) return where;
  return { ...where, dealerId: dealerId.trim() };
}

/**
 * Spread into Prisma create/update data — stamps dealerId on writes when session provides it.
 * MERLINUS SINGLE-DEALER: returns empty object when dealerId is absent.
 */
export function dealerIdWriteFields(
  dealerId: string | null | undefined
): { dealerId?: string } {
  const trimmed = dealerId?.trim();
  if (!trimmed) return {};
  return { dealerId: trimmed };
}

/**
 * Scope a nested repairOrder relation (e.g. repairLine → repairOrder filter).
 * MERLINUS SINGLE-DEALER: dealershipId alone when dealerId is absent.
 */
export function withOptionalDealerIdOnRepairOrderScope(
  scope: { id?: string; dealershipId: string },
  dealerId: string | null | undefined
): { id?: string; dealershipId: string; dealerId?: string } {
  return withOptionalDealerId(scope, dealerId);
}

/** Flat dealership scope — optional dealerId filter for list/count queries. */
export function scopedDealershipWhere(
  dealershipId: string,
  dealerId: string | null | undefined
): { dealershipId: string; dealerId?: string } {
  return withOptionalDealerId({ dealershipId }, dealerId);
}