import { decryptSensitiveText } from '@/lib/encryption';
import { buildImageProxyUrl } from '@/lib/imageUrls';

export type MaintenancePhotoRow = {
  id: string;
  pathname: string;
  contentType: string;
  createdAt: Date;
};

export type MaintenanceEventRow = {
  id: string;
  type: string;
  payloadEncrypted: string;
  actorId: string | null;
  createdAt: Date;
  actor?: { name: string } | null;
};

export type MaintenanceTicketRow = {
  id: string;
  dealershipId: string;
  dealerId: string | null;
  createdById: string;
  assignedToId: string | null;
  department: string;
  title: string;
  descriptionEncrypted: string;
  severity: string;
  status: string;
  locationLabel: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { name: string } | null;
  assignedTo?: { name: string } | null;
  photos?: MaintenancePhotoRow[];
  events?: MaintenanceEventRow[];
};

export function mapMaintenancePhoto(row: MaintenancePhotoRow) {
  return {
    id: row.id,
    pathname: row.pathname,
    contentType: row.contentType,
    url: buildImageProxyUrl(row.pathname),
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapMaintenanceEvent(row: MaintenanceEventRow) {
  return {
    id: row.id,
    type: row.type,
    payload: decryptSensitiveText(row.payloadEncrypted || ''),
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function mapMaintenanceTicketSummary(row: MaintenanceTicketRow) {
  return {
    id: row.id,
    department: row.department,
    title: row.title,
    severity: row.severity,
    status: row.status,
    locationLabel: row.locationLabel,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? null,
    assignedToId: row.assignedToId,
    assignedToName: row.assignedTo?.name ?? null,
    photoCount: row.photos?.length ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapMaintenanceTicketDetail(row: MaintenanceTicketRow) {
  return {
    ...mapMaintenanceTicketSummary(row),
    description: decryptSensitiveText(row.descriptionEncrypted || ''),
    photos: (row.photos ?? []).map(mapMaintenancePhoto),
    events: (row.events ?? [])
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(mapMaintenanceEvent),
  };
}
