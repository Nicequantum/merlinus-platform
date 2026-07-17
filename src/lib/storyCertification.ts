import 'server-only';

import type { RepairLine, RepairOrder } from '@/types';
import { encryptPII } from './encryption';
import { readEncryptedPiiTolerant } from './piiFieldRead';
import { hashWarrantyStory } from './storyHash';

export interface StoryCertificationState {
  certifiedByName: string;
  certifiedAt: string;
  storyHash: string;
  certifiedByTechnicianId: string;
}

export const CLEAR_STORY_CERTIFICATION_DB = {
  storyCertifiedAt: null as Date | null,
  storyCertifiedByTechnicianId: null as string | null,
  storyCertifiedByNameEncrypted: '',
  storyCertifiedHash: '',
};

type DbLineCertFields = {
  storyCertifiedAt?: Date | null;
  storyCertifiedByTechnicianId?: string | null;
  storyCertifiedByNameEncrypted?: string;
  storyCertifiedHash?: string;
};

export function mapStoryCertificationFromDbLine(line: DbLineCertFields): StoryCertificationState | null {
  if (!line.storyCertifiedAt || !line.storyCertifiedByTechnicianId || !line.storyCertifiedHash?.trim()) {
    return null;
  }

  let certifiedByName = '';
  if (line.storyCertifiedByNameEncrypted) {
    const nameRead = readEncryptedPiiTolerant({ encrypted: line.storyCertifiedByNameEncrypted });
    if (nameRead.decryptFailed) return null;
    certifiedByName = nameRead.value;
  }
  if (!certifiedByName.trim()) return null;

  return {
    certifiedByName: certifiedByName.trim(),
    certifiedAt: line.storyCertifiedAt.toISOString(),
    storyHash: line.storyCertifiedHash.trim(),
    certifiedByTechnicianId: line.storyCertifiedByTechnicianId,
  };
}

export function storyCertificationMatchesStory(
  certification: StoryCertificationState | null | undefined,
  storyText: string | undefined | null
): boolean {
  if (!certification) return false;
  const story = storyText?.trim() ?? '';
  if (!story) return false;
  return certification.storyHash === hashWarrantyStory(story);
}

export function buildStoryCertificationDbFields(input: {
  certifiedAt: Date;
  certifiedByTechnicianId: string;
  certifiedByName: string;
  storyHash: string;
}) {
  return {
    storyCertifiedAt: input.certifiedAt,
    storyCertifiedByTechnicianId: input.certifiedByTechnicianId,
    storyCertifiedByNameEncrypted: encryptPII(input.certifiedByName.trim()),
    storyCertifiedHash: input.storyHash,
  };
}

export function mapStoryCertificationToRepairLine(
  line: RepairLine,
  certification: StoryCertificationState | null
): RepairLine {
  if (!certification || !storyCertificationMatchesStory(certification, line.warrantyStory)) {
    return { ...line, storyCertification: null };
  }
  return { ...line, storyCertification: certification };
}