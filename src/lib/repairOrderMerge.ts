/**
 * Merge server RO snapshots with in-memory client state.
 * Local technician edits always win over stale PUT/companion responses.
 */

import type { ImageAttachment, RepairLine, RepairOrder } from '@/types';

function preferClientText(client: string | undefined | null, server: string | undefined | null): string {
  const c = (client ?? '').trim();
  const s = (server ?? '').trim();
  if (!c) return server ?? '';
  if (!s) return client ?? '';
  // Local edit wins when content differs (save race / companion snapshot).
  if (c !== s) return client ?? '';
  return server ?? '';
}

function mergeImageLists(
  client: ImageAttachment[] | undefined,
  server: ImageAttachment[] | undefined
): ImageAttachment[] {
  const c = client || [];
  const s = server || [];
  if (c.length === 0) return s;
  if (s.length === 0) return c;
  if (c.length > s.length) return c;

  const serverPaths = new Set(s.map((img) => img.pathname));
  const clientOnly = c.filter((img) => img.pathname && !serverPaths.has(img.pathname));
  if (clientOnly.length > 0) {
    // Client has photos the server response dropped
    const byPath = new Map<string, ImageAttachment>();
    for (const img of s) byPath.set(img.pathname, img);
    for (const img of c) byPath.set(img.pathname, img);
    return [...byPath.values()];
  }
  return s;
}

function mergeOcrTexts(client: string[] | undefined, server: string[] | undefined, imageCount: number): string[] {
  const c = client || [];
  const s = server || [];
  if (c.length === 0) return s;
  if (s.length === 0) return c;
  const out: string[] = [];
  const n = Math.max(c.length, s.length, imageCount);
  for (let i = 0; i < n; i++) {
    const ct = (c[i] ?? '').trim();
    const st = (s[i] ?? '').trim();
    // Prefer real analysis over placeholders / empty
    if (ct && (!st || st.startsWith('[Analyzing') || st.startsWith('[Analysis failed'))) {
      out.push(c[i] ?? '');
    } else if (st) {
      out.push(s[i] ?? '');
    } else {
      out.push(c[i] ?? s[i] ?? '');
    }
  }
  return out;
}

function mergeLine(server: RepairLine, client: RepairLine | undefined): RepairLine {
  if (!client) return server;

  const xentryImages = mergeImageLists(client.xentryImages, server.xentryImages);
  const xentryOcrTexts = mergeOcrTexts(client.xentryOcrTexts, server.xentryOcrTexts, xentryImages.length);

  return {
    ...server,
    warrantyStory: preferClientText(client.warrantyStory, server.warrantyStory),
    technicianNotes: preferClientText(client.technicianNotes, server.technicianNotes),
    customerConcern: preferClientText(client.customerConcern, server.customerConcern),
    xentryImages,
    xentryOcrTexts,
    // Keep client certification only if server has none; otherwise server is source of truth
    storyCertification: server.storyCertification ?? client.storyCertification ?? null,
    storyQualityAudit: server.storyQualityAudit ?? client.storyQualityAudit ?? null,
    isCustomerPay: client.isCustomerPay ?? server.isCustomerPay,
  };
}

/**
 * Apply server persistence/companion GET over local state without losing newer edits.
 * Always inherits server `updatedAt` for optimistic concurrency.
 */
export function mergePersistedWithClient(
  server: RepairOrder,
  client: RepairOrder | null | undefined
): RepairOrder {
  if (!client || client.id !== server.id) return server;

  const clientLinesById = new Map(client.repairLines.map((l) => [l.id, l]));
  const serverLineIds = new Set(server.repairLines.map((l) => l.id));

  const repairLines = server.repairLines.map((line) =>
    mergeLine(line, clientLinesById.get(line.id))
  );

  // Preserve client-only lines not yet on server (rare temp ids)
  for (const line of client.repairLines) {
    if (!serverLineIds.has(line.id) && line.id.startsWith('line-')) {
      repairLines.push(line);
    }
  }

  const xentryImages = mergeImageLists(client.xentryImages, server.xentryImages);
  const xentryOcrTexts = mergeOcrTexts(
    client.xentryOcrTexts,
    server.xentryOcrTexts,
    xentryImages.length
  );

  return {
    ...server,
    // Server updatedAt wins — required for next PUT concurrency token
    updatedAt: server.updatedAt,
    complaints:
      client.complaints?.length && client.complaints.some((c) => c.trim())
        ? client.complaints
        : server.complaints,
    complaintIds: client.complaintIds?.length ? client.complaintIds : server.complaintIds,
    complaintLabels: client.complaintLabels?.length ? client.complaintLabels : server.complaintLabels,
    serviceAdvisorName: preferClientText(client.serviceAdvisorName, server.serviceAdvisorName),
    vehicle: {
      ...server.vehicle,
      vin: preferClientText(client.vehicle?.vin, server.vehicle?.vin) || server.vehicle.vin,
      mileageIn:
        preferClientText(client.vehicle?.mileageIn, server.vehicle?.mileageIn) ||
        server.vehicle.mileageIn,
      mileageOut:
        preferClientText(client.vehicle?.mileageOut, server.vehicle?.mileageOut) ||
        server.vehicle.mileageOut,
      year: preferClientText(client.vehicle?.year, server.vehicle?.year) || server.vehicle.year,
      make: preferClientText(client.vehicle?.make, server.vehicle?.make) || server.vehicle.make,
      model: preferClientText(client.vehicle?.model, server.vehicle?.model) || server.vehicle.model,
      engine: preferClientText(client.vehicle?.engine, server.vehicle?.engine) || server.vehicle.engine,
    },
    customer: {
      ...server.customer,
      name: preferClientText(client.customer?.name, server.customer?.name) || server.customer.name,
    },
    xentryImages,
    xentryOcrTexts,
    repairLines: repairLines.sort((a, b) => a.lineNumber - b.lineNumber),
  };
}

/** True when client has local edits that should block remote full-replace. */
export function clientHasLocalEditsBeyond(
  client: RepairOrder | null | undefined,
  server: RepairOrder
): boolean {
  if (!client || client.id !== server.id) return false;
  const merged = mergePersistedWithClient(server, client);
  // Cheap structural compare on high-value fields
  for (const line of client.repairLines) {
    const s = server.repairLines.find((l) => l.id === line.id);
    if (!s) continue;
    if ((line.warrantyStory || '').trim() !== (s.warrantyStory || '').trim()) return true;
    if ((line.technicianNotes || '').trim() !== (s.technicianNotes || '').trim()) return true;
    if ((line.xentryImages?.length || 0) > (s.xentryImages?.length || 0)) return true;
  }
  if ((client.xentryImages?.length || 0) > (server.xentryImages?.length || 0)) return true;
  // If merge would change anything material, treat as dirty relative to server
  return JSON.stringify(merged.repairLines.map(lineFingerprint)) !==
    JSON.stringify(server.repairLines.map(lineFingerprint));
}

function lineFingerprint(line: RepairLine): string {
  return [
    line.id,
    (line.warrantyStory || '').trim().slice(0, 80),
    (line.technicianNotes || '').trim().slice(0, 80),
    String(line.xentryImages?.length || 0),
  ].join('|');
}
