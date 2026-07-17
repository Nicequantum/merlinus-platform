import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { rlsTransaction } from '@/lib/apex/rlsContext';
import { logger } from '@/lib/logger';
import { sanitizeTechnicianLogMetadata } from '@/lib/technicianLogMetadata';

export type TechnicianLogCategory = 'app_start' | 'story';

export type TechnicianLogEvent =
  | 'app.ready'
  | 'story.generate'
  | 'story.score'
  | 'story.review'
  | 'story.certify';

export interface WriteTechnicianActivityLogInput {
  dealershipId: string;
  /** APEX NATIONAL PLATFORM — optional franchise tenant stamp on writes. */
  dealerId?: string | null;
  technicianId: string;
  category: TechnicianLogCategory;
  event: TechnicianLogEvent;
  message: string;
  repairOrderId?: string;
  repairLineId?: string;
  clientSessionId?: string;
  metadata?: Record<string, unknown>;
}

/** M-FINAL-2: strip plaintext RO numbers from durable activity messages (IDs remain in repairOrderId). */
function sanitizeActivityLogMessage(message: string): string {
  return message.replace(/\bRO\s+[^\s,]+/gi, 'RO [redacted]');
}

/** Non-blocking operational log — never fails parent workflows. */
export async function writeTechnicianActivityLog(
  input: WriteTechnicianActivityLogInput
): Promise<void> {
  try {
    const metadata = sanitizeTechnicianLogMetadata(input.metadata);
    await rlsTransaction(async (tx) => {
      await tx.technicianActivityLog.create({
        data: {
          dealershipId: input.dealershipId,
          ...dealerIdWriteFields(input.dealerId),
          technicianId: input.technicianId,
          category: input.category,
          event: input.event,
          message: sanitizeActivityLogMessage(input.message).slice(0, 500),
          repairOrderId: input.repairOrderId,
          repairLineId: input.repairLineId,
          clientSessionId: input.clientSessionId,
          metadata: JSON.stringify(metadata),
        },
      });
    });
  } catch (error) {
    logger.warn('technician_activity_log.write_failed', {
      event: input.event,
      technicianId: input.technicianId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}