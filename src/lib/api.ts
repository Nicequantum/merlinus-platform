import type {
  AdvisorDetail,
  AdvisorListItem,
  RepairLine,
  RepairLineSoldMetrics,
  AuditDashboardSummary,
  AuditLogEntry,
  DashboardSummary,
  KnowledgeBaseEntry,
  RepairOrder,
  RepairOrderSummary,
  SaveTemplateFromStoryPayload,
  StoryQualityResult,
  StoryReviewResult,
  StoryTemplate,
  StructuredROExtraction,
  TechnicianActivityLogEntry,
  TechnicianCertifiedStoryItem,
  TechnicianDetail,
  TechnicianListItem,
  TechnicianSession,
  TemplateCategory,
  ExtractedData,
  UsageAnalytics,
} from '@/types';
import {
  isNetworkFailure,
  isRetriableHttpStatus,
  networkRetryDelayMs,
  NETWORK_RETRY_MAX_ATTEMPTS,
  parseRetryAfterMs,
  sleep,
} from '@/lib/networkErrors';
import { isRequestAborted } from '@/lib/requestAbort';
import {
  API_DEFAULT_CLIENT_MS,
  DIAGNOSTIC_EXTRACT_CLIENT_MS,
  RO_CRUD_CLIENT_MS,
  RO_EXTRACT_CLIENT_MS,
  STORY_GENERATE_CLIENT_MS,
  STORY_REVIEW_CLIENT_MS,
  STORY_SCORE_CLIENT_MS,
  UPLOAD_CLIENT_MS,
} from '@/lib/timeouts';

export interface TechnicianUser {
  id: string;
  d7Number: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  consentAt?: string | null;
  deletedAt?: string | null;
}

export interface ClerkLinkStatus {
  clerkEnabled: boolean;
  legacySignedIn: boolean;
  clerkSignedIn: boolean;
  linked: boolean;
  canLink: boolean;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fetchWithNetworkRetry(
  path: string,
  init: RequestInit,
  timeoutMs?: number,
  externalSignal?: AbortSignal,
  maxRetries: number = NETWORK_RETRY_MAX_ATTEMPTS
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (externalSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort);
    const timer =
      timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

    try {
      const res = await fetch(path, {
        ...init,
        signal: controller.signal,
      });

      if (
        !res.ok &&
        isRetriableHttpStatus(res.status) &&
        attempt < maxRetries
      ) {
        const retryAfterMs =
          res.status === 429 ? parseRetryAfterMs(res.headers.get('Retry-After')) : undefined;
        await sleep(retryAfterMs ?? networkRetryDelayMs(attempt));
        continue;
      }

      return res;
    } catch (error) {
      if (isRequestAborted(error)) {
        if (externalSignal?.aborted) {
          throw error;
        }
        throw new ApiError(`Request timed out after ${Math.round((timeoutMs || 0) / 1000)}s`, 408);
      }

      lastError = error;
      if (!isNetworkFailure(error) || attempt === maxRetries) {
        throw error;
      }

      await sleep(networkRetryDelayMs(attempt));
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
      if (timer) clearTimeout(timer);
    }
  }

  throw lastError;
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number; signal?: AbortSignal; maxRetries?: number }
): Promise<T> {
  const { timeoutMs, signal, maxRetries, ...fetchOptions } = options || {};
  const res = await fetchWithNetworkRetry(
    path,
    {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
      credentials: 'include',
    },
    timeoutMs,
    signal,
    maxRetries
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || 'Request failed. Please try again.', res.status);
  }

  return res.json();
}

async function apiUpload<T>(path: string, formData: FormData, timeoutMs?: number): Promise<T> {
  const res = await fetchWithNetworkRetry(
    path,
    {
      method: 'POST',
      body: formData,
      credentials: 'include',
    },
    timeoutMs
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || 'Upload failed. Please try again.', res.status);
  }

  return res.json();
}

export const api = {
  login: (d7Number: string, password: string) =>
    apiFetch<{ session: TechnicianSession }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ d7Number, password }),
    }),

  logout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => apiFetch<{ session: TechnicianSession | null }>('/api/auth/me'),

  getClerkLinkStatus: () => apiFetch<ClerkLinkStatus>('/api/auth/clerk/link'),

  linkClerkAccount: () =>
    apiFetch<{ linked: boolean; session: TechnicianSession }>('/api/auth/clerk/link', {
      method: 'POST',
    }),

  acceptConsent: () =>
    apiFetch<{
      consentAt: string;
      consentVersion: string;
      session: TechnicianSession;
    }>('/api/consent', { method: 'POST' }),

  acceptLegalDisclaimer: () =>
    apiFetch<{
      legalDisclaimerAt: string;
      legalDisclaimerVersion: string;
      session: TechnicianSession;
    }>('/api/legal-disclaimer', {
      method: 'POST',
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ ok: boolean; requiresReauth?: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  updatePreferences: (preferredLanguage: string) =>
    apiFetch<{ preferredLanguage: string; session: TechnicianSession }>('/api/auth/preferences', {
      method: 'POST',
      body: JSON.stringify({ preferredLanguage }),
    }),

  listVideoInspections: (params?: { status?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    return apiFetch<{ inspections: import('@/types').VideoInspectionSummary[] }>(
      `/api/video-inspections${qs ? `?${qs}` : ''}`,
      { cache: 'no-store' }
    );
  },

  getVideoInspection: (id: string) =>
    apiFetch<{ inspection: import('@/types').VideoInspectionDetail }>(
      `/api/video-inspections/${id}`,
      { cache: 'no-store' }
    ),

  uploadVideoInspection: (form: FormData) =>
    apiUpload<{ inspection: import('@/types').VideoInspectionDetail }>(
      '/api/video-inspections/upload',
      form,
      180_000
    ),

  generateVideoInspectionReport: (id: string) =>
    apiFetch<{ inspection: import('@/types').VideoInspectionDetail }>(
      `/api/video-inspections/${id}/generate-report`,
      { method: 'POST', timeoutMs: 140_000, maxRetries: 0 }
    ),

  patchVideoInspection: (
    id: string,
    body: {
      title?: string;
      vehicleLabel?: string | null;
      report?: string;
      transcript?: string;
      customerName?: string;
      customerPhone?: string;
      vin?: string;
      recordingMode?: 'fullscreen' | 'standard' | 'upload';
      status?: 'draft' | 'processing' | 'ready' | 'failed' | 'sent';
      deliveryChannel?: 'sms' | 'email' | 'link' | null;
    }
  ) =>
    apiFetch<{ inspection: import('@/types').VideoInspectionDetail }>(
      `/api/video-inspections/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  putVideoInspectionFindings: (
    id: string,
    findings: Array<{
      category: string;
      severity?: 'ok' | 'recommend' | 'urgent';
      note?: string;
      timestampSec?: number | null;
      sortOrder?: number;
    }>
  ) =>
    apiFetch<{
      findings: import('@/types').VideoInspectionFinding[];
      inspection: import('@/types').VideoInspectionDetail;
    }>(`/api/video-inspections/${id}/findings`, {
      method: 'PUT',
      body: JSON.stringify({ findings }),
    }),

  shareVideoInspection: (id: string, body?: { passcode?: string; expiresInHours?: number }) =>
    apiFetch<{ shareId: string; url: string; token: string; expiresAt: string }>(
      `/api/video-inspections/${id}/share`,
      { method: 'POST', body: JSON.stringify(body ?? {}) }
    ),

  sendVideoInspectionSms: (id: string, phone: string) =>
    apiFetch<{ ok: boolean; shareUrl: string; phoneLast4: string }>(
      `/api/video-inspections/${id}/send-sms`,
      { method: 'POST', body: JSON.stringify({ phone }) }
    ),

  listRepairOrders: (
    params?: {
      limit?: number;
      cursor?: string;
      scope?: 'today' | 'previous';
      q?: string;
    },
    options?: { signal?: AbortSignal }
  ) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.scope) query.set('scope', params.scope);
    if (params?.q?.trim()) query.set('q', params.q.trim());
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiFetch<{
      repairOrders: RepairOrderSummary[];
      nextCursor?: string | null;
      hasMore?: boolean;
      scope?: 'today' | 'previous' | 'search';
      todayStart?: string;
    }>(`/api/repair-orders${suffix}`, {
      timeoutMs: API_DEFAULT_CLIENT_MS,
      signal: options?.signal,
    });
  },

  getRepairOrder: (id: string) =>
    apiFetch<{ repairOrder: RepairOrder }>(`/api/repair-orders/${id}`, {
      timeoutMs: RO_CRUD_CLIENT_MS,
    }),

  createRepairOrder: (
    data: Partial<RepairOrder> & {
      fromExtraction?: boolean;
      customerName?: string;
      advisorExtractionSource?: 'grok' | 'ocr_fallback' | 'manual';
    },
    options?: { idempotencyKey?: string }
  ) =>
    apiFetch<{ repairOrder: RepairOrder; idempotent?: boolean }>('/api/repair-orders', {
      method: 'POST',
      body: JSON.stringify(data),
      timeoutMs: RO_CRUD_CLIENT_MS,
      maxRetries: 0,
      headers: options?.idempotencyKey
        ? { 'Idempotency-Key': options.idempotencyKey }
        : undefined,
    }),

  updateRepairOrder: (id: string, data: Partial<RepairOrder>) =>
    apiFetch<{ repairOrder: RepairOrder }>(`/api/repair-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
      timeoutMs: RO_CRUD_CLIENT_MS,
      // Never auto-retry full-document PUT (amplifies 409 / double-write risk).
      maxRetries: 0,
    }),

  /** Lightweight line field patch (notes/story/concern/description) — not a full RO PUT. */
  patchRepairLine: (
    roId: string,
    lineId: string,
    data: {
      description?: string;
      customerConcern?: string;
      technicianNotes?: string;
      warrantyStory?: string;
      updatedAt?: string;
    }
  ) =>
    apiFetch<{ line: RepairLine; updatedAt: string }>(
      `/api/repair-orders/${roId}/lines/${lineId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
        timeoutMs: RO_CRUD_CLIENT_MS,
        maxRetries: 0,
      }
    ),

  deleteRepairOrder: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/repair-orders/${id}`, {
      method: 'DELETE',
      timeoutMs: API_DEFAULT_CLIENT_MS,
      maxRetries: 0,
    }),

  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiUpload<{ pathname: string; url: string; name: string }>(
      '/api/upload',
      formData,
      UPLOAD_CLIENT_MS
    );
  },

  listAdvisors: () => apiFetch<{ advisors: AdvisorListItem[] }>('/api/advisors'),

  getAdvisor: (id: string) => apiFetch<{ advisor: AdvisorDetail }>(`/api/advisors/${id}`),

  createAdvisor: (data: { displayName: string; advisorCode?: string }) =>
    apiFetch<{ advisor: AdvisorListItem }>('/api/advisors', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAdvisor: (
    id: string,
    data: { status: 'active' | 'inactive'; csiScore?: number | null }
  ) =>
    apiFetch<{ advisor: AdvisorListItem }>(`/api/advisors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteAdvisor: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/advisors/${id}`, { method: 'DELETE' }),

  saveRepairLineSoldMetrics: (
    roId: string,
    lineId: string,
    data: Partial<RepairLineSoldMetrics>
  ) =>
    apiFetch<{ lineId: string; soldMetrics: RepairLineSoldMetrics }>(
      `/api/repair-orders/${roId}/lines/${lineId}/sold-metrics`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    ),

  listTechnicians: () => apiFetch<{ technicians: TechnicianListItem[] }>('/api/technicians'),

  getTechnician: (id: string) => apiFetch<{ technician: TechnicianDetail }>(`/api/technicians/${id}`),

  listTechnicianLogs: (id: string, params?: { category?: 'app_start' | 'story'; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.category) search.set('category', params.category);
    if (params?.limit) search.set('limit', String(params.limit));
    const qs = search.toString();
    return apiFetch<{ logs: TechnicianActivityLogEntry[] }>(
      `/api/technicians/${id}/logs${qs ? `?${qs}` : ''}`
    );
  },

  listTechnicianStories: (id: string, params?: { limit?: number; cursor?: string }) => {
    const search = new URLSearchParams();
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.cursor) search.set('cursor', params.cursor);
    const qs = search.toString();
    return apiFetch<{ stories: TechnicianCertifiedStoryItem[]; nextCursor: string | null }>(
      `/api/technicians/${id}/stories${qs ? `?${qs}` : ''}`
    );
  },

  recordTechnicianAppStart: (payload: {
    clientSessionId: string;
    metadata?: {
      role?: string;
      todayRoCount?: number;
      previousRoCount?: number;
      appVersion?: string;
    };
  }) =>
    apiFetch<{ ok: boolean }>('/api/technician-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAdvisorIntelligenceSummary: () =>
    apiFetch<{
      advisorIntelligence: {
        advisors: number;
        observations: number;
        profiles: number;
        linkedRepairOrders: number;
        recentAdvisors: Array<{
          id: string;
          displayName: string;
          roCount: number;
          lastSeenAt: string;
          observationCount: number;
          profileUpdatedAt: string | null;
        }>;
        recentCaptures: Array<{
          id: string;
          createdAt: string;
          metadata: Record<string, unknown>;
        }>;
      };
    }>('/api/advisors/summary'),

  extractRO: (imagePathnames: string[], options?: { signal?: AbortSignal }) =>
    apiFetch<StructuredROExtraction>('/api/repair-orders/extract', {
      method: 'POST',
      body: JSON.stringify({ imagePathnames }),
      timeoutMs: RO_EXTRACT_CLIENT_MS,
      signal: options?.signal,
      maxRetries: 0,
    }),

  extractDiagnostics: (imagePathname: string, options?: { signal?: AbortSignal }) =>
    apiFetch<ExtractedData>('/api/diagnostics/extract', {
      method: 'POST',
      body: JSON.stringify({ imagePathnames: [imagePathname] }),
      timeoutMs: DIAGNOSTIC_EXTRACT_CLIENT_MS,
      signal: options?.signal,
      maxRetries: 0,
    }),

  generateStory: (
    roId: string,
    lineId: string,
    body?: { technicianNotes?: string; warrantyStory?: string }
  ) =>
    apiFetch<{ warrantyStory: string; quality: StoryQualityResult | null; cdkSanitized?: boolean }>(
      `/api/repair-orders/${roId}/lines/${lineId}/generate-story`,
      {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
        timeoutMs: STORY_GENERATE_CLIENT_MS,
        maxRetries: 0,
      }
    ),

  scoreStory: (
    roId: string,
    lineId: string,
    warrantyStory: string,
    options?: { technicianNotes?: string }
  ) =>
    apiFetch<{ quality: StoryQualityResult }>(
      `/api/repair-orders/${roId}/lines/${lineId}/score-story`,
      {
        method: 'POST',
        body: JSON.stringify({
          warrantyStory,
          ...(options?.technicianNotes !== undefined
            ? { technicianNotes: options.technicianNotes }
            : {}),
        }),
        timeoutMs: STORY_SCORE_CLIENT_MS,
        maxRetries: 0,
      }
    ),

  reviewStory: (roId: string, lineId: string, warrantyStory: string) =>
    apiFetch<{ review: StoryReviewResult }>(
      `/api/repair-orders/${roId}/lines/${lineId}/review-story`,
      {
        method: 'POST',
        body: JSON.stringify({ warrantyStory }),
        timeoutMs: STORY_REVIEW_CLIENT_MS,
        maxRetries: 0,
      }
    ),

  certifyStory: (roId: string, lineId: string, warrantyStory: string, certifiedByName: string) =>
    apiFetch<{ warrantyStory: string; certifiedAt: string; certifiedByName: string; storyHash: string }>(
      `/api/repair-orders/${roId}/lines/${lineId}/certify-story`,
      {
        method: 'POST',
        body: JSON.stringify({ warrantyStory, certifiedByName }),
        timeoutMs: 30_000,
        maxRetries: 0,
      }
    ),

  /** Customer Pay — instant pre-written story; bypasses Grok and quality audit. */
  applyCustomerPayTemplate: (roId: string, lineId: string, templateId: string) =>
    apiFetch<{ warrantyStory: string; templateTitle: string; isCustomerPay: true; idempotent?: boolean; cdkSanitized?: boolean }>(
      `/api/repair-orders/${roId}/lines/${lineId}/apply-customer-pay-template`,
      { method: 'POST', body: JSON.stringify({ templateId }), timeoutMs: 15_000, maxRetries: 0 }
    ),

  /** M1: clear Customer Pay mode so warranty AI generation can resume. */
  clearCustomerPayMode: (roId: string, lineId: string) =>
    apiFetch<{ ok: boolean; isCustomerPay: false }>(
      `/api/repair-orders/${roId}/lines/${lineId}/clear-customer-pay`,
      { method: 'POST', timeoutMs: 15_000, maxRetries: 0 }
    ),

  listTemplates: (category?: TemplateCategory) => {
    const query = category ? `?category=${category}` : '';
    return apiFetch<{ templates: StoryTemplate[] }>(`/api/templates${query}`, { timeoutMs: 30_000 });
  },

  listKnowledgeBase: (category?: TemplateCategory) => {
    const query = category ? `?category=${category}` : '';
    return apiFetch<{ entries: KnowledgeBaseEntry[] }>(`/api/knowledge-base${query}`);
  },

  saveTemplateFromStory: (payload: SaveTemplateFromStoryPayload) =>
    apiFetch<{ template: StoryTemplate; knowledgeBase: KnowledgeBaseEntry; tags: string[] }>(
      '/api/templates/save-from-story',
      { method: 'POST', body: JSON.stringify(payload), timeoutMs: 30_000, maxRetries: 0 }
    ),

  recordTemplateUse: (templateId: string) =>
    apiFetch<{ ok: boolean }>(`/api/templates/${templateId}/use`, {
      method: 'POST',
      timeoutMs: 15_000,
      maxRetries: 0,
    }),

  decodeVin: (vin: string) =>
    apiFetch<{
      vin: string;
      year: string;
      make: string;
      model: string;
      engine: string;
      trim: string;
      valid: boolean;
    }>('/api/vin/decode', {
      method: 'POST',
      body: JSON.stringify({ vin }),
      timeoutMs: API_DEFAULT_CLIENT_MS,
      maxRetries: 1,
    }),

  listUsers: () => apiFetch<{ users: TechnicianUser[] }>('/api/users'),

  createUser: (data: {
    d7Number: string;
    name: string;
    password: string;
    role: 'technician' | 'manager' | 'service_advisor' | 'parts' | 'maintenance';
    serviceAdvisorLinkMode?: 'existing' | 'create';
    serviceAdvisorId?: string;
    newAdvisorDisplayName?: string;
    newAdvisorCode?: string;
  }) =>
    apiFetch<{ user: TechnicianUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (id: string, data: { isActive: boolean }) =>
    apiFetch<{ user: TechnicianUser }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  resetUserPassword: (id: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>(`/api/users/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    }),

  deleteUser: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/users/${id}`, {
      method: 'DELETE',
    }),

  listAuditLogs: (params: {
    technicianId?: string;
    action?: string;
    from?: string;
    to?: string;
  }) => {
    const query = new URLSearchParams();
    if (params.technicianId) query.set('technicianId', params.technicianId);
    if (params.action) query.set('action', params.action);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    query.set('format', 'json');
    return apiFetch<{ logs: AuditLogEntry[]; count: number }>(`/api/audit-logs?${query.toString()}`);
  },

  getAuditSummary: () => apiFetch<AuditDashboardSummary>('/api/audit-logs/summary'),

  getDashboardSummary: () => apiFetch<DashboardSummary>('/api/dashboard/summary'),

  /** PR-M0 — manager read-only product module entitlements for active rooftop. */
  getModuleStatuses: () =>
    apiFetch<{
      dealershipId: string;
      coreStoryAlwaysOn: true;
      modules: Array<{
        moduleId: string;
        name: string;
        description: string;
        enabled: boolean;
        source: 'force_env' | 'dealership' | 'dealer_group' | 'default';
      }>;
    }>('/api/modules'),

  /** PR-M2 — department inbox (Parts first). */
  listDepartmentRequests: (params: { department: string; status?: string }) => {
    const query = new URLSearchParams();
    query.set('department', params.department);
    if (params.status) query.set('status', params.status);
    return apiFetch<{
      department: string;
      requests: import('@/types').DepartmentRequestSummary[];
    }>(`/api/department-requests?${query.toString()}`, { cache: 'no-store' });
  },

  getDepartmentRequest: (id: string) =>
    apiFetch<{ request: import('@/types').DepartmentRequestDetail }>(
      `/api/department-requests/${id}`,
      { cache: 'no-store' }
    ),

  createDepartmentRequest: (body: {
    department: string;
    subject: string;
    summary?: string;
    priority?: string;
    source?: string;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    vin?: string;
    vehicleLabel?: string;
    stockOrRoHint?: string;
    assignedToId?: string;
    partsLines?: Array<{
      partNumber?: string;
      description: string;
      qty?: number;
      status?: string;
      vendor?: string;
      notes?: string;
    }>;
  }) =>
    apiFetch<{ request: import('@/types').DepartmentRequestDetail }>('/api/department-requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchDepartmentRequest: (
    id: string,
    body: {
      subject?: string;
      summary?: string;
      status?: string;
      priority?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      vin?: string;
      vehicleLabel?: string | null;
      stockOrRoHint?: string | null;
      assignedToId?: string | null;
    }
  ) =>
    apiFetch<{ request: import('@/types').DepartmentRequestDetail }>(
      `/api/department-requests/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  putPartsRequestLines: (
    id: string,
    lines: Array<{
      partNumber?: string | null;
      description: string;
      qty?: number;
      status?: string;
      quotedPriceCents?: number | null;
      vendor?: string | null;
      notes?: string;
    }>
  ) =>
    apiFetch<{
      lines: import('@/types').PartsRequestLineDto[];
      request: import('@/types').DepartmentRequestDetail;
    }>(`/api/department-requests/${id}/parts-lines`, {
      method: 'PUT',
      body: JSON.stringify({ lines }),
    }),

  addPartsLookup: (
    id: string,
    body: { query: string; result?: Record<string, unknown>; source?: 'staff' | 'voice' | 'cdk' }
  ) =>
    apiFetch<{ lookup: import('@/types').PartsLookupEventDto }>(
      `/api/department-requests/${id}/lookups`,
      { method: 'POST', body: JSON.stringify(body) }
    ),

  /** PR-M3 — facility / shop maintenance tickets. */
  listMaintenanceTickets: (params?: {
    status?: string;
    severity?: string;
    department?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.department) query.set('department', params.department);
    const qs = query.toString();
    return apiFetch<{ tickets: import('@/types').MaintenanceTicketSummary[] }>(
      `/api/maintenance/tickets${qs ? `?${qs}` : ''}`,
      { cache: 'no-store' }
    );
  },

  getMaintenanceTicket: (id: string) =>
    apiFetch<{ ticket: import('@/types').MaintenanceTicketDetail }>(
      `/api/maintenance/tickets/${id}`,
      { cache: 'no-store' }
    ),

  createMaintenanceTicket: (body: {
    title: string;
    description?: string;
    severity?: string;
    department?: string;
    locationLabel?: string;
    dueAt?: string | null;
    assignedToId?: string | null;
  }) =>
    apiFetch<{ ticket: import('@/types').MaintenanceTicketDetail }>('/api/maintenance/tickets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchMaintenanceTicket: (
    id: string,
    body: {
      title?: string;
      description?: string;
      severity?: string;
      status?: string;
      department?: string;
      locationLabel?: string | null;
      dueAt?: string | null;
      assignedToId?: string | null;
      comment?: string;
    }
  ) =>
    apiFetch<{ ticket: import('@/types').MaintenanceTicketDetail }>(
      `/api/maintenance/tickets/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  uploadMaintenancePhotos: (id: string, form: FormData) =>
    apiUpload<{ ticket: import('@/types').MaintenanceTicketDetail; photosAdded: number }>(
      `/api/maintenance/tickets/${id}/photos`,
      form,
      60_000
    ),

  getUsageAnalytics: () => apiFetch<UsageAnalytics>('/api/admin/usage'),

  exportAuditLogsCsv: (params: {
    technicianId?: string;
    action?: string;
    from?: string;
    to?: string;
  }) => {
    const query = new URLSearchParams();
    if (params.technicianId) query.set('technicianId', params.technicianId);
    if (params.action) query.set('action', params.action);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    query.set('format', 'csv');
    return `/api/audit-logs?${query.toString()}`;
  },
};