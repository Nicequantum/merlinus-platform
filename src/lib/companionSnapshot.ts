import type { RepairOrder } from '@/types';

export interface CompanionSnapshotDelta {
  auditCompleted: Array<{ lineId: string; score: number }>;
  newlyCertified: Array<{ lineId: string; certifiedByName: string }>;
  storyUpdated: string[];
  notesUpdated: string[];
  photosUpdated: Array<{ scope: 'ro' | 'line'; lineId?: string }>;
}

function imageUrls(images: { url: string }[] | undefined): string {
  return (images ?? []).map((image) => image.url).join('|');
}

export function diffCompanionRepairOrder(
  previous: RepairOrder | null,
  next: RepairOrder
): CompanionSnapshotDelta {
  const delta: CompanionSnapshotDelta = {
    auditCompleted: [],
    newlyCertified: [],
    storyUpdated: [],
    notesUpdated: [],
    photosUpdated: [],
  };

  if (!previous || previous.id !== next.id) return delta;

  if (imageUrls(previous.xentryImages) !== imageUrls(next.xentryImages)) {
    delta.photosUpdated.push({ scope: 'ro' });
  }

  for (const line of next.repairLines) {
    const prior = previous.repairLines.find((entry) => entry.id === line.id);
    if (!prior) continue;

    const prevScore = prior.storyQualityAudit?.score;
    const nextScore = line.storyQualityAudit?.score;
    if (nextScore != null && nextScore !== prevScore) {
      delta.auditCompleted.push({ lineId: line.id, score: nextScore });
    }

    if (line.storyCertification && !prior.storyCertification) {
      delta.newlyCertified.push({
        lineId: line.id,
        certifiedByName: line.storyCertification.certifiedByName,
      });
    }

    if ((line.warrantyStory?.trim() ?? '') !== (prior.warrantyStory?.trim() ?? '')) {
      delta.storyUpdated.push(line.id);
    }

    const notesChanged =
      (line.technicianNotes?.trim() ?? '') !== (prior.technicianNotes?.trim() ?? '') ||
      (line.customerConcern?.trim() ?? '') !== (prior.customerConcern?.trim() ?? '');
    if (notesChanged) {
      delta.notesUpdated.push(line.id);
    }

    if (imageUrls(prior.xentryImages) !== imageUrls(line.xentryImages)) {
      delta.photosUpdated.push({ scope: 'line', lineId: line.id });
    }
  }

  return delta;
}

export function companionSnapshotHasChanges(delta: CompanionSnapshotDelta): boolean {
  return (
    delta.auditCompleted.length > 0 ||
    delta.newlyCertified.length > 0 ||
    delta.storyUpdated.length > 0 ||
    delta.notesUpdated.length > 0 ||
    delta.photosUpdated.length > 0
  );
}