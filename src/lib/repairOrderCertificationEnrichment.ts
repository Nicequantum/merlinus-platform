import 'server-only';

import { getRlsDb } from '@/lib/apex/rlsContext';
import { hashWarrantyStory } from './storyHash';
import type { RepairOrder } from '@/types';

/** Legacy rows: hydrate certification from TechnicianCertifiedStory when RepairLine fields are empty. */
export async function enrichRepairOrderCertification(
  ro: RepairOrder,
  dealershipId: string
): Promise<RepairOrder> {
  const needsEnrichment = ro.repairLines.some(
    (line) => !line.isCustomerPay && line.warrantyStory?.trim() && !line.storyCertification
  );
  if (!needsEnrichment) return ro;

  const certifiedStories = await getRlsDb().technicianCertifiedStory.findMany({
    where: { repairOrderId: ro.id, dealershipId },
    orderBy: { certifiedAt: 'desc' },
    select: {
      repairLineId: true,
      technicianId: true,
      certifiedAt: true,
      certifiedByName: true,
    },
  });
  if (certifiedStories.length === 0) return ro;

  const latestByLine = new Map<string, (typeof certifiedStories)[number]>();
  for (const story of certifiedStories) {
    if (!latestByLine.has(story.repairLineId)) {
      latestByLine.set(story.repairLineId, story);
    }
  }

  return {
    ...ro,
    repairLines: ro.repairLines.map((line) => {
      if (line.storyCertification || line.isCustomerPay) return line;
      const storyText = line.warrantyStory?.trim() ?? '';
      if (!storyText) return line;

      const legacy = latestByLine.get(line.id);
      if (!legacy) return line;

      return {
        ...line,
        storyCertification: {
          certifiedByName: legacy.certifiedByName,
          certifiedAt: legacy.certifiedAt.toISOString(),
          storyHash: hashWarrantyStory(storyText),
          certifiedByTechnicianId: legacy.technicianId,
        },
      };
    }),
  };
}