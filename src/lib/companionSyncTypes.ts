import type { AppView, RepairLine, RepairOrder, StoryQualityResult } from '@/types';

export type CompanionConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type CompanionWorkflowStatus =
  | 'idle'
  | 'listening'
  | 'generating'
  | 'scoring'
  | 'reviewing'
  | 'processing_xentry'
  | 'certifying'
  | 'scanning';

export type CompanionEventType =
  | 'navigation'
  | 'ro.refresh'
  | 'ro.patch'
  | 'status'
  | 'activity'
  | 'story.quality'
  | 'story.certification';

export interface CompanionBaseEvent {
  id: string;
  type: CompanionEventType;
  sourceDeviceId: string;
  technicianId: string;
  seq?: number;
  timestamp: string;
}

export interface CompanionNavigationEvent extends CompanionBaseEvent {
  type: 'navigation';
  view: AppView;
  repairOrderId: string | null;
  lineId: string | null;
}

export interface CompanionRORefreshEvent extends CompanionBaseEvent {
  type: 'ro.refresh';
  repairOrderId: string;
  reason?: string;
}

export interface CompanionROPatchEvent extends CompanionBaseEvent {
  type: 'ro.patch';
  repairOrderId: string;
  lineId?: string;
  linePatch?: Partial<RepairLine>;
  roPatch?: Partial<Pick<RepairOrder, 'roNumber' | 'complaints' | 'vehicle' | 'customer'>>;
  updatedAt?: string;
}

export interface CompanionStatusEvent extends CompanionBaseEvent {
  type: 'status';
  status: CompanionWorkflowStatus;
  message?: string;
  repairOrderId?: string | null;
  lineId?: string | null;
  progress?: number;
}

export interface CompanionActivityEvent extends CompanionBaseEvent {
  type: 'activity';
  label: string;
  detail?: string;
  repairOrderId?: string | null;
  lineId?: string | null;
}

export interface CompanionStoryQualityEvent extends CompanionBaseEvent {
  type: 'story.quality';
  repairOrderId: string;
  lineId: string;
  quality: StoryQualityResult;
}

export interface CompanionStoryCertificationEvent extends CompanionBaseEvent {
  type: 'story.certification';
  repairOrderId: string;
  lineId: string;
  certifiedByName: string;
  certifiedAt: string;
  warrantyStory: string;
  storyHash?: string;
}

export type CompanionEvent =
  | CompanionNavigationEvent
  | CompanionRORefreshEvent
  | CompanionROPatchEvent
  | CompanionStatusEvent
  | CompanionActivityEvent
  | CompanionStoryQualityEvent
  | CompanionStoryCertificationEvent;

export interface CompanionActivityEntry {
  id: string;
  label: string;
  detail?: string;
  timestamp: string;
  repairOrderId?: string | null;
  lineId?: string | null;
}

export const COMPANION_ACTIVITY_LABELS: Record<string, string> = {
  'navigation.ro': 'Opened repair order',
  'navigation.line': 'Opened repair line',
  'navigation.home': 'Returned to home',
  'story.generate': 'Generated warranty story',
  'story.score': 'Ran MI audit',
  'story.review': 'Ran AI review',
  'story.certify': 'Certified story',
  'story.customer_pay': 'Applied Customer Pay template',
  'xentry.upload': 'Uploaded Xentry photos',
  'line.edit': 'Updated line fields',
  'ro.save': 'Saved repair order',
};