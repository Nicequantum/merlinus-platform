import { getRlsDb } from '@/lib/apex/rlsContext';
import { extractPathnameFromImageRef } from './imageUrls';
import { logger } from './logger';

export type ImageAccessSession = {
  technicianId: string;
  role: string;
  dealershipId: string;
  serviceAdvisorId?: string | null;
  isOwner?: boolean;
  scopeMode?: string;
  viewAsRole?: string | null;
  viewAsServiceAdvisorId?: string | null;
};

/** How long a freshly uploaded blob stays accessible before RO attachment. */
export const RECENT_UPLOAD_ACCESS_MS = 60 * 60 * 1000;

/** Bound RO scan for image attachment checks (Phase 7.1 H4). */
const IMAGE_ACCESS_RO_SCAN_LIMIT = 150;

function pathnamesFromImageJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (typeof item === 'string') {
          return extractPathnameFromImageRef(item);
        }
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          if (typeof record.pathname === 'string') {
            return record.pathname;
          }
          if (typeof record.url === 'string') {
            return extractPathnameFromImageRef(record.url);
          }
        }
        return null;
      })
      .filter((pathname): pathname is string => Boolean(pathname));
  } catch {
    return [];
  }
}

export function auditMetadataHasPathname(metadataRaw: string, pathname: string): boolean {
  try {
    const parsed = JSON.parse(metadataRaw) as Record<string, unknown>;
    return parsed.pathname === pathname;
  } catch {
    return false;
  }
}

function roleScopedRoWhere(session: ImageAccessSession) {
  const role =
    session.role === 'owner' && session.scopeMode === 'dealership' && session.viewAsRole
      ? session.viewAsRole
      : session.role;
  const advisorId =
    role === 'service_advisor'
      ? session.viewAsServiceAdvisorId?.trim() || session.serviceAdvisorId
      : session.serviceAdvisorId;

  return {
    dealershipId: session.dealershipId,
    ...(role === 'manager' || role === 'owner'
      ? {}
      : role === 'service_advisor' && advisorId
        ? { serviceAdvisorId: advisorId }
        : { technicianId: session.technicianId }),
  };
}

/**
 * H9 — targeted pathname lookup: filter by JSON text contains, then exact-parse match.
 * Avoids loading the full dealership RO table for single-path access checks.
 */
export async function repairOrderContainsPathname(
  session: ImageAccessSession,
  pathname: string
): Promise<boolean> {
  if (!pathname) return false;
  const db = getRlsDb();
  const scope = roleScopedRoWhere(session);

  // Pre-filter with string contains (indexed table scan bound), then exact JSON parse.
  const candidates = await db.repairOrder.findMany({
    where: {
      ...scope,
      OR: [
        { xentryImageUrls: { contains: pathname } },
        { repairLines: { some: { xentryImageUrls: { contains: pathname } } } },
      ],
    },
    select: {
      xentryImageUrls: true,
      repairLines: { select: { xentryImageUrls: true } },
    },
    take: 25,
  });

  for (const ro of candidates) {
    if (pathnamesFromImageJson(ro.xentryImageUrls).includes(pathname)) return true;
    for (const line of ro.repairLines) {
      if (pathnamesFromImageJson(line.xentryImageUrls).includes(pathname)) return true;
    }
  }
  return false;
}

/**
 * Phase 7.1 H4 — one RO query, build attached pathname set in memory (no per-path N+1).
 * Used when checking many pathnames at once (extract / attach flows).
 */
async function loadAttachedPathnames(session: ImageAccessSession): Promise<Set<string>> {
  const db = getRlsDb();
  const candidates = await db.repairOrder.findMany({
    where: roleScopedRoWhere(session),
    select: {
      xentryImageUrls: true,
      repairLines: { select: { xentryImageUrls: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: IMAGE_ACCESS_RO_SCAN_LIMIT,
  });

  const attached = new Set<string>();
  for (const ro of candidates) {
    for (const p of pathnamesFromImageJson(ro.xentryImageUrls)) {
      attached.add(p);
    }
    for (const line of ro.repairLines) {
      for (const p of pathnamesFromImageJson(line.xentryImageUrls)) {
        attached.add(p);
      }
    }
  }
  return attached;
}

/**
 * Phase 7.1 H4 — batch recent-upload grants for a set of pathnames (2 queries max).
 */
async function loadRecentUploadPathnames(
  session: ImageAccessSession,
  pathnames: string[]
): Promise<Set<string>> {
  if (pathnames.length === 0) return new Set();
  const since = new Date(Date.now() - RECENT_UPLOAD_ACCESS_MS);
  const db = getRlsDb();
  const allowed = new Set<string>();

  const byEntityId = await db.auditLog.findMany({
    where: {
      action: 'image.upload',
      dealershipId: session.dealershipId,
      technicianId: session.technicianId,
      entityId: { in: pathnames },
      createdAt: { gte: since },
    },
    select: { entityId: true },
  });
  for (const row of byEntityId) {
    if (row.entityId) allowed.add(row.entityId);
  }

  const remaining = pathnames.filter((p) => !allowed.has(p));
  if (remaining.length === 0) return allowed;

  const recentUploads = await db.auditLog.findMany({
    where: {
      action: 'image.upload',
      dealershipId: session.dealershipId,
      technicianId: session.technicianId,
      createdAt: { gte: since },
    },
    select: { metadata: true, entityId: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const remainingSet = new Set(remaining);
  for (const entry of recentUploads) {
    if (entry.entityId && remainingSet.has(entry.entityId)) {
      allowed.add(entry.entityId);
      continue;
    }
    for (const p of remainingSet) {
      if (auditMetadataHasPathname(entry.metadata, p)) {
        allowed.add(p);
      }
    }
  }

  return allowed;
}

/** True when the session may read this private blob (RO attachment or recent own upload). */
export async function userCanAccessImage(
  session: ImageAccessSession,
  pathname: string
): Promise<boolean> {
  if (!pathname) return false;
  // H9 — single-path: targeted contains query (not full RO table scan).
  if (await repairOrderContainsPathname(session, pathname)) return true;
  const recent = await loadRecentUploadPathnames(session, [pathname]);
  return recent.has(pathname);
}

/** Returns the first pathname the session may not attach, or null when all are allowed. */
export async function findForbiddenImagePathname(
  session: ImageAccessSession,
  pathnames: string[]
): Promise<string | null> {
  const unique = [...new Set(pathnames.filter(Boolean))];
  if (unique.length === 0) return null;

  // Phase 7.1 H4 — batch: one RO scan + batch upload audit, then O(n) set checks
  const [attached, recent] = await Promise.all([
    loadAttachedPathnames(session),
    loadRecentUploadPathnames(session, unique),
  ]);

  for (const pathname of unique) {
    if (attached.has(pathname) || recent.has(pathname)) continue;
    logger.warn('image.access_denied', {
      pathname,
      technicianId: session.technicianId,
      dealershipId: session.dealershipId,
    });
    return pathname;
  }
  return null;
}

export function collectRepairOrderImagePathnames(input: {
  xentryImages?: Array<{ pathname: string }>;
  repairLines?: Array<{ xentryImages?: Array<{ pathname: string }> }>;
}): string[] {
  const pathnames: string[] = [];
  for (const image of input.xentryImages || []) {
    if (image.pathname) pathnames.push(image.pathname);
  }
  for (const line of input.repairLines || []) {
    for (const image of line.xentryImages || []) {
      if (image.pathname) pathnames.push(image.pathname);
    }
  }
  return pathnames;
}
