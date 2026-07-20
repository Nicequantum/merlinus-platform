export interface FaultCode {
  code: string;
  description: string;
  status?: string;
}

export interface ExtractedData {
  /** @deprecated Prefer faultCodes — kept in sync for backward compatibility */
  codes: string[];
  faultCodes: FaultCode[];
  guidedTests: string[];
  measurements: Array<{ label: string; value: string }>;
  components: string[];
  circuits: string[];
}

export interface ImageAttachment {
  id: string;
  pathname: string;
  url: string;
  name: string;
}

export type PendingImageUploadStatus = 'uploading' | 'saved' | 'error';

export interface PendingImage {
  id: string;
  previewUrl: string;
  name: string;
  /** Present until blob upload completes; optional when `attachment` is already saved. */
  file?: File;
  /** Set after immediate blob upload — survives refresh when backed by ro-scan draft storage. */
  attachment?: ImageAttachment;
  uploadStatus?: PendingImageUploadStatus;
}

export interface RepairLine {
  id: string;
  lineNumber: number;
  description: string;
  customerConcern: string;
  technicianNotes: string;
  xentryImages: ImageAttachment[];
  xentryOcrTexts?: string[];
  extractedData?: ExtractedData;
  warrantyStory?: string;
  /** Persisted MI audit/review result — survives RO reload when story text still matches. */
  storyQualityAudit?: StoryQualityResult | null;
  /** Set when a Customer Pay template was applied — bypasses AI generation and quality audit. */
  isCustomerPay?: boolean;
  /** M1: client-only flag to explicitly clear Customer Pay on save. */
  clearCustomerPay?: boolean;
  /** Client-only flag to clear a persisted MI audit on the next RO save. */
  clearStoryQualityAudit?: boolean;
  /** Persisted technician certification — survives RO reload when story hash still matches. */
  storyCertification?: {
    certifiedByName: string;
    certifiedAt: string;
    storyHash: string;
    certifiedByTechnicianId: string;
  } | null;
  /** Advisor-captured sold metrics — persisted on RepairLine, read-only in technician/manager UI. */
  soldMetrics?: RepairLineSoldMetrics;
}

export interface RepairLineSoldMetrics {
  soldLaborHours: number | null;
  soldLaborAmount: number | null;
  soldPartsAmount: number | null;
  customerApproved: boolean | null;
  isAddOn: boolean | null;
  soldMetricsUpdatedAt?: string | null;
}

export interface VehicleWarrantyInfo {
  factoryWarranty?: string;
  cpoWarranty?: string;
  extendedElaWarranty?: string;
  serviceHistoryNotes?: string;
}

export interface VehicleInfo {
  vin: string;
  year: string;
  make: string;
  model: string;
  engine?: string;
  mileageIn: string;
  mileageOut: string;
  /** Populated from VMI pages — never from RO complaint lines. */
  warrantyInfo?: VehicleWarrantyInfo;
}

export interface ServiceAdvisorSummary {
  id: string;
  displayName: string;
  matchConfidence?: number;
}

export interface RepairOrder {
  id: string;
  roNumber: string;
  vehicle: VehicleInfo;
  customer: {
    name: string;
  };
  complaints: string[];
  /** Original RO line letters (A, B, C, E, F…) when extracted from scan; falls back to index order. */
  complaintLabels?: string[];
  /** Stable React keys for complaint textareas — prevents remount loops during edits. */
  complaintIds?: string[];
  serviceAdvisor?: ServiceAdvisorSummary;
  serviceAdvisorName?: string;
  xentryImages?: ImageAttachment[];
  xentryOcrTexts?: string[];
  repairLines: RepairLine[];
  createdAt?: string;
  updatedAt?: string;
  technicianId?: string;
  technicianName?: string;
  /** Present when one or more encrypted fields failed to decrypt (legacy key mismatch, corruption). */
  piiDecryptWarnings?: string[];
}

/** Lightweight line shape for RO list views — no decrypted PII or story text. */
export interface RepairLineSummary {
  id: string;
  lineNumber: number;
  isCustomerPay?: boolean;
  hasWarrantyStory: boolean;
  soldMetrics?: RepairLineSoldMetrics;
}

/** Lightweight RO shape for list/search endpoints — avoids decrypting every line field. */
export interface RepairOrderSummary {
  id: string;
  roNumber: string;
  vehicle: Pick<VehicleInfo, 'year' | 'make' | 'model'>;
  firstComplaintPreview?: string;
  repairLines: RepairLineSummary[];
  createdAt?: string;
  updatedAt?: string;
  technicianId?: string;
  technicianName?: string;
}

export type AppView =
  | 'home'
  | 'ro'
  | 'line'
  | 'settings'
  | 'audit'
  | 'advisors'
  | 'technicians'
  | 'videoInspection'
  | 'parts'
  | 'sales'
  | 'service'
  | 'maintenance'
  | 'loaner'
  | 'voice'
  | 'hub';

export type MaintenanceSeverity = 'low' | 'medium' | 'high' | 'critical';
export type MaintenanceTicketStatus =
  | 'submitted'
  | 'triage'
  | 'scheduled'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'cancelled';

export interface MaintenancePhotoDto {
  id: string;
  pathname: string;
  contentType: string;
  url: string;
  createdAt: string;
}

export interface MaintenanceTicketEventDto {
  id: string;
  type: string;
  payload: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface MaintenanceTicketSummary {
  id: string;
  department: string;
  title: string;
  severity: string;
  status: string;
  locationLabel: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdById: string;
  createdByName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceTicketDetail extends MaintenanceTicketSummary {
  description: string;
  photos: MaintenancePhotoDto[];
  events: MaintenanceTicketEventDto[];
}

export type DepartmentId = 'sales' | 'service' | 'parts' | 'loaner' | 'maintenance';

export type DepartmentRequestStatus =
  | 'new'
  | 'in_progress'
  | 'waiting_customer'
  | 'resolved'
  | 'closed';

export interface PartsRequestLineDto {
  id: string;
  partNumber: string | null;
  description: string;
  qty: number;
  status: string;
  quotedPriceCents: number | null;
  vendor: string | null;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PartsLookupEventDto {
  id: string;
  query: string;
  result: unknown;
  source: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface DepartmentRequestSummary {
  id: string;
  department: string;
  source: string;
  status: string;
  priority: string;
  subject: string;
  vehicleLabel: string | null;
  vinLast8: string | null;
  customerPhoneLast4: string | null;
  stockOrRoHint: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdByName: string | null;
  partsLineCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentRequestDetail extends DepartmentRequestSummary {
  summary: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  vin: string;
  voiceCallId: string | null;
  createdById: string | null;
  metadataJson: string;
  partsLines: PartsRequestLineDto[];
  partsLookups: PartsLookupEventDto[];
}

export type VideoMpiSeverity = 'ok' | 'recommend' | 'urgent';

export interface VideoInspectionFinding {
  id: string;
  category: string;
  severity: VideoMpiSeverity | string;
  note: string;
  timestampSec: number | null;
  framePathname: string | null;
  sortOrder: number;
}

export interface VideoInspectionSummary {
  id: string;
  status: string;
  title: string;
  vehicleLabel: string | null;
  transcriptLanguage: string;
  hasVideo: boolean;
  hasReport: boolean;
  durationSec: number | null;
  sizeBytes: number;
  technicianName: string | null;
  dealershipName: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  /** PR-M1a */
  vinLast8?: string | null;
  customerPhoneLast4?: string | null;
  severitySummary?: string | null;
  severityCounts?: { ok: number; recommend: number; urgent: number };
  findingCount?: number;
  recordingMode?: string;
  deliveryChannel?: string | null;
  deliveredAt?: string | null;
  repairOrderId?: string | null;
  repairLineId?: string | null;
}

export interface VideoInspectionDetail extends VideoInspectionSummary {
  contentType: string;
  videoPathname: string | null;
  mediaUrl: string | null;
  frameCount: number;
  transcript: string;
  report: string;
  reportPromptVersion: string | null;
  repairOrderId: string | null;
  repairLineId: string | null;
  /** PR-M1a MPI */
  customerName?: string;
  customerPhone?: string;
  vin?: string;
  mpiChecklistJson?: string;
  findings?: VideoInspectionFinding[];
}

export type TemplateCategory = 'customer' | 'warranty';

export interface StoryTemplate {
  id: string;
  title: string;
  category: TemplateCategory;
  content: string;
  isCustomerPay?: boolean;
  /** M1: client-only flag to explicitly clear Customer Pay on save. */
  clearCustomerPay?: boolean;
  templateType?: 'Warranty' | 'CustomerPay';
  description?: string | null;
  source?: string;
  dealershipId?: string;
  useCount?: number;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface KnowledgeBaseEntry {
  id: string;
  title: string;
  category: TemplateCategory;
  generatedText?: string | null;
  fullOriginalText: string;
  cleanTemplate: string;
  tags: string[];
  source?: string;
  dealershipId?: string;
  createdAt: string;
  updatedAt?: string;
}

export type StoryQualityGrade = 'excellent' | 'strong' | 'needs-work' | 'at-risk';

export interface TechnicianDetailPrompt {
  missing: string;
  prompt: string;
  field: 'technicianNotes' | 'customerConcern' | 'diagnostic' | 'workflow';
}

export interface StoryQualityResult {
  score: number;
  grade: StoryQualityGrade;
  strengths: string[];
  improvements: string[];
  auditRisks: string[];
  technicianDetails: TechnicianDetailPrompt[];
  summary: string;
  scoredAgainstStory?: string;
  /** True when Grok returned unreadable output — not a real zero score. */
  parseFailed?: boolean;
}

export interface StoryReviewFeedback {
  structure: string;
  technicalDetail: string;
  clarity: string;
  workflow: string;
  fabricationRisk: string;
}

export interface StoryReviewResult extends StoryQualityResult {
  feedback: StoryReviewFeedback;
  priorityActions: string[];
}

export interface SaveTemplateFromStoryPayload {
  title: string;
  category: TemplateCategory;
  finalText: string;
  generatedText: string;
  lineDescription?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  codes?: string[];
  repairOrderId?: string;
  lineId?: string;
}

export interface AdvisorPerformanceMetrics {
  rosWritten: number;
  approvalRate: number | null;
  closingRatio: number | null;
  avgRepairOrderValue: number | null;
  totalRevenue: number | null;
  upsellRate: number | null;
  csiScore: number | null;
}

export interface AdvisorListItem {
  id: string;
  displayName: string;
  advisorCode: string | null;
  status: 'active' | 'inactive';
  roCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  observationCount: number;
  profileUpdatedAt: string | null;
  typicallyAllCaps: boolean;
  commonPhraseCount: number;
  metrics: AdvisorPerformanceMetrics;
}

export interface AdvisorProfileData {
  formatting: {
    usesLetterLabels: boolean;
    labelStyle: string;
    typicallyAllCaps: boolean;
    avgComplaintsPerRo: number;
    avgComplaintLength: number;
  };
  abbreviations: Record<string, string>;
  commonPhrases: Array<{ text: string; count: number }>;
  vehicleAffinities: Record<string, number>;
  complaintCategories: Record<string, unknown>;
  extractionHints: string[];
}

export interface AdvisorDetail {
  id: string;
  displayName: string;
  advisorCode: string | null;
  status: 'active' | 'inactive';
  roCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  metrics: AdvisorPerformanceMetrics;
  profile: {
    observationCount: number;
    profileVersion: number;
    lastComputedAt: string | null;
    profileData: AdvisorProfileData | null;
  } | null;
  recentObservations: Array<{
    id: string;
    lineLabel: string | null;
    roNumber: string;
    vehicleFamily: string | null;
    vehicle: string;
    complaint: string;
    observedAt: string;
  }>;
}

export interface TechnicianListItem {
  id: string;
  d7Number: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  certifiedStoryCount: number;
  lastCertifiedAt: string | null;
  hasOnboardingRecord: boolean;
}

export interface TechnicianOnboardingRecord {
  consentAt: string | null;
  consentVersion: string | null;
  legalDisclaimerAt: string | null;
  legalDisclaimerVersion: string | null;
  firstAppLaunchAt: string | null;
  firstAppLaunchSessionId: string | null;
}

export interface TechnicianCertifiedStoryItem {
  id: string;
  repairOrderId: string;
  repairLineId: string;
  roNumber: string;
  lineNumber: number;
  certifiedAt: string;
  certifiedByName: string;
  promptVersion: string;
}

export interface TechnicianActivityLogEntry {
  id: string;
  category: 'app_start' | 'story';
  event: string;
  message: string;
  repairOrderId: string | null;
  repairLineId: string | null;
  clientSessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TechnicianDetail {
  id: string;
  d7Number: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  certifiedStoryCount: number;
  lastCertifiedAt: string | null;
  onboarding: TechnicianOnboardingRecord;
}

export interface StructuredROExtraction {
  vehicle: VehicleInfo;
  complaints: string[];
  complaintLabels?: string[];
  customerName: string;
  roNumber: string;
  serviceAdvisorName?: string;
}

export interface TechnicianSession {
  technicianId: string;
  /** Null for owner accounts (Phase 5 apex mode). */
  d7Number: string | null;
  name: string;
  role: string;
  isAdmin: boolean;
  dealershipId: string;
  dealershipName: string;
  serviceAdvisorId: string | null;
  consentAt: string | null;
  consentVersion: string | null;
  legalDisclaimerAt: string | null;
  legalDisclaimerVersion: string | null;
  /** APEX — national (platform) | group (DealerGroup) | dealership (entered rooftop). */
  scopeMode?: 'national' | 'group' | 'dealership';
  isOwner?: boolean;
  activeDealershipId?: string;
  /** Active franchise portfolio when scopeMode is group (PR-G2). */
  activeDealerGroupId?: string;
  dealerGroupName?: string;
  /** True until first successful password change after provision/admin reset. */
  mustChangePassword?: boolean;
  /** Phase 7.3 — IANA timezone for active rooftop day boundaries / usage. */
  dealershipTimezone?: string;
  /**
   * National Owner View As — effective staff role lens while scopeMode is dealership.
   * Identity stays role=owner; regenerations/other users are unaffected.
   */
  viewAsRole?: 'technician' | 'manager' | 'service_advisor' | null;
  /** GM lens: admin privileges in rooftop only (session flag, not DB). */
  viewAsAdmin?: boolean;
  /** Bound service advisor when viewAsRole is service_advisor. */
  viewAsServiceAdvisorId?: string | null;
  /** Technician preferred UI/voice language (`en` | `es`). Story output remains English. */
  preferredLanguage?: string;
}

export interface TechnicianUsageSummary {
  technicianId: string;
  name: string;
  d7Number: string | null;
  role: string;
  dailyCount: number;
  weeklyCount: number;
}

export interface UsageAnalytics {
  dailyLimit: number;
  totalDailyUsage: number;
  technicians: TechnicianUsageSummary[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  technicianId: string | null;
  technicianName: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  entryHash?: string | null;
  promptVersion?: string | null;
}

export interface AuditChainInfo {
  enabled: true;
  description: string;
  hashedEntries: number;
  legacyEntries: number;
  valid: boolean;
  brokenAt: number | null;
  headHash: string | null;
  limitations: string[];
}

export interface AuditDashboardSummary {
  totalEntries: number;
  last24Hours: number;
  last7Days: number;
  actionCounts: Array<{ action: string; count: number }>;
  recentActivity: Array<{
    id: string;
    action: string;
    technicianName: string | null;
    createdAt: string;
  }>;
  chain: AuditChainInfo;
}

export interface DashboardSummary {
  role: string;
  stats: {
    totalRepairOrders: number;
    warrantyStories: number;
    activeTechnicians: number;
    auditEventsThisWeek: number;
  };
  recentRepairOrders: Array<{
    id: string;
    roNumber: string;
    year: string;
    make: string;
    model: string;
    technicianName: string;
    lineCount: number;
    hasStories: boolean;
    updatedAt: string;
  }>;
  audit: AuditDashboardSummary | null;
}

export const CONSENT_VERSION = '2026-06-07-v1';

/** One-time technician legal disclaimer (client localStorage gate). */
export const LEGAL_DISCLAIMER_VERSION = '2026-06-26-v1';
/** Legacy DMS guidance — informational only; stories are not blocked at this length. */
export const WARRANTY_STORY_DMS_GUIDANCE_CHARS = 2500;
/** Effectively unlimited — matches backend validation ceiling for warranty narratives. */
export const WARRANTY_STORY_MAX_CHARS = 100_000;
export const WARRANTY_STORY_WARN_CHARS = 100_000;

export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.refresh',
  'auth.select_dealership',
  'owner.dealership_enter',
  'owner.dealership_exit',
  'owner.national_access',
  'auth.password_change',
  'auth.clerk_link',
  'consent.accept',
  'legalDisclaimer.accept',
  'preferences.update',
  'ro.create',
  'ro.read',
  'ro.list',
  'ro.update',
  'ro.delete',
  'ro.extract',
  'audit.access',
  'auth.session_revoke',
  'diagnostics.extract',
  'story.generate',
  'story.score',
  'story.review',
  'story.edit',
  'story.certify',
  'story.pdf_export',
  'user.create',
  'user.deactivate',
  'user.reactivate',
  'user.delete',
  'user.password_reset',
  'image.upload',
  'video.upload',
  'video.report_generate',
  'video.share_create',
  'video.sms_send',
  'video.public_view',
  'advisor.resolve',
  'advisor.capture',
  'advisor.create',
  'advisor.deactivate',
  'advisor.reactivate',
  'advisor.delete',
  'advisor.sold_metrics',
  'template.save',
  'template.use',
  'customerPay.clear',
  'customerPayTemplateApplied',
  'customerPayStory.edit',
  'customerPayStory.pdf_export',
  'dealer.provision',
  'module.set',
] as const;