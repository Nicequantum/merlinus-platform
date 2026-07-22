/** P1-1 — async AI job kinds and public statuses. */

export const AI_JOB_KINDS = [
  'hub.summarize',
  'story.generate',
  'video.report',
] as const;

export type AiJobKind = (typeof AI_JOB_KINDS)[number];

export const AI_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export interface AiJobPublicView {
  id: string;
  kind: string;
  status: AiJobStatus;
  progress: number;
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
  /** Parsed result when succeeded (never includes secrets). */
  result: unknown | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** Luxury bay phase derived from status + progress */
  phase?: string;
  technicianId?: string;
}
