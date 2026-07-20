import 'server-only';

import { getRlsDb } from '@/lib/apex/rlsContext';

export async function writeHubAudit(input: {
  dealershipId: string;
  entityType: string;
  entityId: string;
  action: string;
  technicianId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getRlsDb().hubAuditEvent.create({
    data: {
      dealershipId: input.dealershipId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      technicianId: input.technicianId || null,
      metadataJson: JSON.stringify(input.metadata || {}),
    },
  });
}
