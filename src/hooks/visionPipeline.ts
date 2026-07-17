/** RO document scan vs line/RO Xentry diagnostic — mutually exclusive vision pipelines. */
export type VisionPipelineId = 'ro_scan' | 'xentry';

export interface VisionPipelineControls {
  readonly id: VisionPipelineId;
  isProcessing: boolean;
  progress: number;
  statusMessage: string;
  /** Returns false when the other pipeline is active. */
  tryAcquire: () => boolean;
  release: () => void;
  start: (message?: string) => void;
  setProgress: (progress: number) => void;
  setStatusMessage: (message: string) => void;
  finish: () => void;
}

export function visionPipelineBlockedMessage(blocker: VisionPipelineId): string {
  return blocker === 'xentry'
    ? 'Xentry diagnostic processing is in progress — wait or cancel it first.'
    : 'Repair order scan is in progress — wait or cancel it first.';
}