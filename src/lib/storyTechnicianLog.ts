import {
  writeTechnicianActivityLog,
  type TechnicianLogEvent,
} from '@/lib/technicianActivityLog';

interface LogStoryTechnicianActivityInput {
  dealershipId: string;
  dealerId?: string | null;
  technicianId: string;
  event: Extract<TechnicianLogEvent, 'story.generate' | 'story.score' | 'story.review' | 'story.certify'>;
  message: string;
  repairOrderId: string;
  repairLineId: string;
  roNumber: string;
  lineNumber: number;
  metadata?: Record<string, unknown>;
}

export async function logStoryTechnicianActivity(
  input: LogStoryTechnicianActivityInput
): Promise<void> {
  await writeTechnicianActivityLog({
    dealershipId: input.dealershipId,
    dealerId: input.dealerId,
    technicianId: input.technicianId,
    category: 'story',
    event: input.event,
    message: input.message,
    repairOrderId: input.repairOrderId,
    repairLineId: input.repairLineId,
    metadata: {
      roNumber: input.roNumber,
      lineNumber: input.lineNumber,
      ...input.metadata,
    },
  });
}