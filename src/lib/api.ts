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
import { parseApiErrorResponse, readJsonBodySafe } from '@/lib/apiResponseParse';
import { withCsrfHeaders } from '@/lib/csrfClient';
import {
  isNetworkFailure,
  isRetriableHttpStatus,
  networkRetryDelayMs,
  NETWORK_RETRY_MAX_ATTEMPTS,
  parseRetryAfterMs,
  shouldRetryServerErrorForMethod,
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
  const method = (init.method || 'GET').toUpperCase();
  // GET/HEAD: also retry bare 500 (Workers cold-start / first D1 query).
  const includeServerError = shouldRetryServerErrorForMethod(method);

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
        isRetriableHttpStatus(res.status, { includeServerError }) &&
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
      headers: withCsrfHeaders({
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      }),
      credentials: 'include',
    },
    timeoutMs,
    signal,
    maxRetries
  );

  const parsed = await readJsonBodySafe<T>(res);
  if (!parsed.ok) {
    throw new ApiError(parsed.error.message, res.status);
  }
  return parsed.data;
}

async function apiUpload<T>(path: string, formData: FormData, timeoutMs?: number): Promise<T> {
  // maxRetries=0: FormData bodies cannot be safely re-sent after a failed attempt.
  // uploadHelpers retries with a freshly compressed File / new FormData instead.
  const res = await fetchWithNetworkRetry(
    path,
    {
      method: 'POST',
      body: formData,
      credentials: 'include',
      headers: withCsrfHeaders(),
    },
    timeoutMs,
    undefined,
    0
  );

  if (!res.ok) {
    const err = await parseApiErrorResponse(res, 'Upload failed. Please try again.');
    throw new ApiError(err.message, res.status);
  }

  const parsed = await readJsonBodySafe<T>(res);
  if (!parsed.ok) {
    throw new ApiError(parsed.error.message, res.status || 502);
  }
  return parsed.data;
}

export const api = {
  login: (d7Number: string, password: string) =>
    apiFetch<{
      session?: TechnicianSession;
      requiresMfa?: boolean;
      mfaToken?: string;
      technicianId?: string;
      name?: string;
      message?: string;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ d7Number, password }),
    }),

  /** Complete MFA challenge after password stage. */
  verifyMfaLogin: (mfaToken: string, code: string) =>
    apiFetch<{
      session?: TechnicianSession;
      requiresDealershipSelection?: boolean;
      pendingToken?: string;
      mfaVerified?: boolean;
    }>('/api/auth/mfa/login-verify', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code }),
    }),

  mfaStatus: () =>
    apiFetch<{
      enforcementEnabled: boolean;
      requiredRoles: string[];
      mfaEnabled: boolean;
      mfaEnrolled: boolean;
      mfaRequired: boolean;
      enrolledAt: string | null;
      backupCodesRemaining: number;
      role: string;
    }>('/api/auth/mfa/status', { cache: 'no-store' }),

  mfaSetup: (rotate?: boolean) =>
    apiFetch<{
      secret: string;
      otpauthUrl: string;
      qrCodeDataUrl?: string | null;
      message?: string;
    }>('/api/auth/mfa/setup', {
      method: 'POST',
      body: JSON.stringify({ rotate: Boolean(rotate) }),
    }),

  /**
   * Confirm MFA enrollment. Prefer client-generated `secret` (in-app QR flow);
   * server verifies TOTP then stores encrypted secret + backup codes.
   */
  mfaVerifyEnroll: (code: string, secret?: string) =>
    apiFetch<{
      ok: boolean;
      mfaEnabled: boolean;
      requiresReauth?: boolean;
      backupCodes?: string[];
      message?: string;
    }>('/api/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify(secret ? { code, secret } : { code }),
    }),

  mfaRegenerateBackupCodes: (code: string) =>
    apiFetch<{
      ok: boolean;
      backupCodes: string[];
      message?: string;
    }>('/api/auth/mfa/backup-codes', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  listVoiceCustomizations: () =>
    apiFetch<{
      dealershipId: string;
      departments: string[];
      customizations: Array<{
        id: string | null;
        department: string;
        customInstructions: string;
        greeting: string;
        disclaimers: string;
        toneGuidelines: string;
        version: number;
        isCustomized: boolean;
        updatedAt: string | null;
      }>;
    }>('/api/voice/customizations', { cache: 'no-store' }),

  getVoiceCustomization: (department: string) =>
    apiFetch<{
      customization: {
        id: string | null;
        department: string;
        customInstructions: string;
        greeting: string;
        disclaimers: string;
        toneGuidelines: string;
        version: number;
        isCustomized: boolean;
        updatedAt: string | null;
      };
      versions: Array<{
        id: string;
        version: number;
        customInstructions: string;
        greeting: string;
        disclaimers: string;
        toneGuidelines: string;
        changeNote: string;
        createdAt: string;
      }>;
    }>(`/api/voice/customizations/${encodeURIComponent(department)}`, {
      cache: 'no-store',
    }),

  saveVoiceCustomization: (body: {
    department: string;
    customInstructions?: string;
    greeting?: string;
    disclaimers?: string;
    toneGuidelines?: string;
    changeNote?: string;
  }) =>
    apiFetch<{
      ok: boolean;
      customization: {
        version: number;
        isCustomized: boolean;
        department: string;
      };
    }>('/api/voice/customizations', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  resetVoiceCustomization: (department: string) =>
    apiFetch<{ ok: boolean; customization: unknown }>(
      `/api/voice/customizations/${encodeURIComponent(department)}`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'reset' }),
      }
    ),

  restoreVoiceCustomization: (department: string, version: number) =>
    apiFetch<{ ok: boolean; customization: unknown }>(
      `/api/voice/customizations/${encodeURIComponent(department)}`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'restore', version }),
      }
    ),

  /** Manager preview of department Sophia with draft tailoring (no stream). */
  previewVoiceDepartmentQuery: (
    department: string,
    message: string,
    previewTailoring?: {
      customInstructions?: string;
      greeting?: string;
      disclaimers?: string;
      toneGuidelines?: string;
    }
  ) =>
    apiFetch<{
      speech: string;
      conversationId: string;
      activeAgent: string;
      tailoringActive?: boolean;
    }>(`/api/voice/${encodeURIComponent(department)}/query`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        stream: false,
        previewTailoring: previewTailoring || null,
      }),
      timeoutMs: 45_000,
      maxRetries: 0,
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

  listVideoInspections: (params?: { status?: string; repairOrderId?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.repairOrderId) query.set('repairOrderId', params.repairOrderId);
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
    apiFetch<{
      inspection: import('@/types').VideoInspectionDetail;
      reportSource?: 'grok' | 'fallback';
      warning?: string;
    }>(`/api/video-inspections/${id}/generate-report`, {
      method: 'POST',
      timeoutMs: 140_000,
      maxRetries: 0,
    }),

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
      repairOrderId?: string | null;
      repairLineId?: string | null;
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
    apiFetch<{
      ok: boolean;
      smsSent?: boolean;
      shareUrl: string;
      phoneLast4: string;
      error?: string;
    }>(`/api/video-inspections/${id}/send-sms`, {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

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
    body?: {
      technicianNotes?: string;
      warrantyStory?: string;
      /** Prefer durable queue / async job */
      async?: boolean;
      /** Force legacy synchronous Grok path */
      sync?: boolean;
    }
  ) =>
    apiFetch<
      | { warrantyStory: string; quality: StoryQualityResult | null; cdkSanitized?: boolean; async?: false }
      | {
          async: true;
          jobId: string;
          status: string;
          transport?: string;
          phase?: string;
          pollUrl: string;
          message?: string;
        }
    >(`/api/repair-orders/${roId}/lines/${lineId}/generate-story`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      timeoutMs: STORY_GENERATE_CLIENT_MS,
      maxRetries: 0,
    }),

  /** Poll durable AI job (queue or inline). Luxury phases include ai_thinking. */
  getAiJobStatus: (jobId: string) =>
    apiFetch<{
      jobId: string;
      phase: 'queued' | 'processing' | 'ai_thinking' | 'complete' | 'failed' | 'cancelled' | string;
      status: string;
      progress: number;
      kind: string;
      errorMessage: string | null;
      result: unknown;
      pollUrl: string;
      eventsUrl?: string;
      technicianId?: string;
      entityType?: string | null;
      entityId?: string | null;
    }>(`/api/queue/job-status/${jobId}`, {
      method: 'GET',
      timeoutMs: 15_000,
      maxRetries: 1,
    }),

  /** Manager Job Monitor — list rooftop AI jobs. */
  listManagerAiJobs: (params?: {
    status?: string;
    technicianId?: string;
    entityId?: string;
    kind?: string;
    take?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.technicianId) query.set('technicianId', params.technicianId);
    if (params?.entityId) query.set('entityId', params.entityId);
    if (params?.kind) query.set('kind', params.kind);
    if (params?.take) query.set('take', String(params.take));
    const qs = query.toString();
    return apiFetch<{
      jobs: Array<{
        id: string;
        kind: string;
        status: string;
        progress: number;
        phase?: string;
        entityType: string | null;
        entityId: string | null;
        errorMessage: string | null;
        result: unknown;
        startedAt: string | null;
        finishedAt: string | null;
        createdAt: string;
        technicianId?: string;
      }>;
      health: {
        queued: number;
        running: number;
        failedLast24h: number;
        succeededLast24h: number;
        errorRate24h: number;
        oldestQueuedAt: string | null;
        oldestQueuedAgeMs: number | null;
        queueDepth: number;
      };
      metrics: {
        enqueued: number;
        completed: number;
        failed: number;
        retried: number;
        inlineFallback: number;
        byPriority: Record<string, number>;
        byJobType: Record<string, number>;
      };
    }>(`/api/queue/jobs${qs ? `?${qs}` : ''}`, {
      method: 'GET',
      cache: 'no-store',
      timeoutMs: 20_000,
    });
  },

  cancelManagerAiJob: (jobId: string) =>
    apiFetch<{
      ok: boolean;
      jobId: string;
      status: string;
      message: string;
    }>(`/api/queue/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
      timeoutMs: 20_000,
    }),

  retryManagerAiJob: (jobId: string) =>
    apiFetch<{
      ok: boolean;
      previousJobId: string;
      jobId: string;
      transport: string;
      status: string;
      pollUrl: string;
      eventsUrl: string;
      message: string;
    }>(`/api/queue/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
      body: JSON.stringify({}),
      timeoutMs: 30_000,
    }),

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
    role:
      | 'technician'
      | 'manager'
      | 'service_advisor'
      | 'parts'
      | 'sales'
      | 'service'
      | 'maintenance'
      | 'loaner';
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

  /** Manager Control Center aggregate (KPIs, health, jobs, modules, voice). */
  getEncryptionRotationStatus: () =>
    apiFetch<{
      ok: boolean;
      keys: {
        primaryFingerprint: string;
        previousFingerprint: string | null;
        dualKeyActive: boolean;
        recommendCloseDualKey: boolean;
        candidateDecryptKeys: number;
      };
      rotation: {
        id: string;
        status: string;
        progressPercent: number;
        processedRecords: number;
        totalRecords: number;
        updatedRecords: number;
        failedRecords: number;
        currentTable: string;
        dualKeyActive: boolean;
        errorMessage: string | null;
      } | null;
      canStartReencrypt: boolean;
      instructions: string[];
      coverage?: {
        tableCount: number;
        columnCount: number;
        includesMfa: boolean;
        planVersion: string;
        tables: Array<{ table: string; label: string; columns: string[] }>;
      };
      mfaStaleProbe?: {
        sampled: number;
        stillOnPreviousKey: number;
        decryptFailed: number;
        tablesChecked: string[];
      } | null;
    }>('/api/manager/encryption/rotate', { cache: 'no-store' }),

  beginEncryptionRotation: () =>
    apiFetch<{
      ok: boolean;
      newKey: string;
      previousKeyFingerprint: string;
      newKeyFingerprint: string;
      rotation: unknown;
      warning?: string;
    }>('/api/manager/encryption/rotate', {
      method: 'POST',
      body: JSON.stringify({ action: 'begin' }),
    }),

  /** Verify pasted new key against live dual-key env; optionally start re-encrypt. */
  confirmEncryptionEnvKey: (input: {
    newKey: string;
    rotationId?: string;
    startReencrypt?: boolean;
  }) =>
    apiFetch<{
      ok: boolean;
      verified: boolean;
      message: string;
      rotation: unknown;
      fingerprints: {
        submitted: string;
        livePrimary: string;
        livePrevious: string | null;
        target: string;
      };
    }>('/api/manager/encryption/rotate', {
      method: 'POST',
      body: JSON.stringify({
        action: 'confirm-env',
        newKey: input.newKey,
        rotationId: input.rotationId,
        startReencrypt: input.startReencrypt !== false,
      }),
    }),

  startEncryptionReencrypt: (rotationId?: string) =>
    apiFetch<{ ok: boolean; rotation: unknown; message?: string }>(
      '/api/manager/encryption/rotate',
      {
        method: 'POST',
        body: JSON.stringify({ action: 'start-reencrypt', rotationId }),
      }
    ),

  cancelEncryptionRotation: (rotationId?: string) =>
    apiFetch<{ ok: boolean; rotation: unknown }>('/api/manager/encryption/rotate', {
      method: 'POST',
      body: JSON.stringify({ action: 'cancel', rotationId }),
    }),

  getManagerCenterSummary: () =>
    apiFetch<{
      dealershipId: string;
      generatedAt: string;
      kpis: {
        totalRepairOrders: number;
        activeTechnicians: number;
        warrantyStories: number;
        auditEventsThisWeek: number;
        aiJobsToday: number;
        aiJobsActive: number;
        voiceQueriesApprox7d: number;
        modulesEnabled: number;
        modulesTotal: number;
      };
      health: {
        overall: 'ok' | 'degraded' | 'error';
        maintenanceMode: boolean;
        services: Record<string, { status: string; latencyMs?: number }>;
        critical: Array<{
          id: string;
          label: string;
          status: 'ok' | 'warn' | 'error';
          latencyMs?: number;
        }>;
      };
      queue: {
        queued: number;
        running: number;
        failedLast24h: number;
        succeededLast24h: number;
        errorRate24h: number;
        queueDepth: number;
        oldestQueuedAgeMs: number | null;
        oldestQueuedAt?: string | null;
      };
      queueSignal?: {
        status: 'ok' | 'warn' | 'error';
        detail?: string;
        operatorGuidance: string;
        oldestQueuedAgeMs: number | null;
        oldestQueuedAgeMinutes: number | null;
        queueConfigured: boolean;
      };
      queueMetrics: {
        enqueued: number;
        completed: number;
        failed: number;
        retried: number;
        inlineFallback: number;
        byJobType: Record<string, number>;
        byPriority: Record<string, number>;
      };
      recentJobs: Array<{
        id: string;
        kind: string;
        status: string;
        progress: number;
        phase?: string;
        technicianId?: string;
        createdAt: string;
        errorMessage: string | null;
      }>;
      modules: Array<{
        moduleId: string;
        name: string;
        description: string;
        enabled: boolean;
        source: string;
      }>;
      voice: {
        parentEnabled: boolean;
        departments: Array<{
          department: string;
          moduleId: string;
          enabled: boolean;
          tailoringActive: boolean;
          tailoringVersion: number;
        }>;
      };
      quickLinks: Array<{ id: string; label: string; href: string; description: string }>;
    }>('/api/manager/center/summary', {
      method: 'GET',
      cache: 'no-store',
      timeoutMs: 25_000,
    }),

  /** PR-M0 — manager product module entitlements for active rooftop. */
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

  /** Manager enable/disable a product module for the active rooftop. */
  setModuleEnabled: (moduleId: string, enabled: boolean) =>
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
      updated: {
        moduleId: string;
        enabled: boolean;
        source: string;
        forceEnvActive: boolean;
      };
    }>('/api/modules', {
      method: 'PATCH',
      body: JSON.stringify({ moduleId, enabled }),
    }),

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

  /** PR-M4 — loaner fleet */
  listLoanerVehicles: (params?: { status?: string; available?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.available) query.set('available', '1');
    const qs = query.toString();
    return apiFetch<{ vehicles: Array<Record<string, unknown>> }>(
      `/api/loaner/vehicles${qs ? `?${qs}` : ''}`,
      { cache: 'no-store' }
    );
  },

  createLoanerVehicle: (body: {
    unitNumber: string;
    vin?: string;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    plate?: string;
    color?: string | null;
    odometer?: number;
    status?: string;
    notes?: string;
  }) =>
    apiFetch<{ vehicle: Record<string, unknown> }>('/api/loaner/vehicles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchLoanerVehicle: (id: string, body: Record<string, unknown>) =>
    apiFetch<{ vehicle: Record<string, unknown> }>(`/api/loaner/vehicles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  listLoanerAssignments: (params?: { status?: string; open?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.open) query.set('open', '1');
    const qs = query.toString();
    return apiFetch<{ assignments: Array<Record<string, unknown>> }>(
      `/api/loaner/assignments${qs ? `?${qs}` : ''}`,
      { cache: 'no-store' }
    );
  },

  getLoanerAssignment: (id: string) =>
    apiFetch<{ assignment: Record<string, unknown> }>(`/api/loaner/assignments/${id}`, {
      cache: 'no-store',
    }),

  createLoanerAssignment: (body: {
    loanerVehicleId: string;
    customerName?: string;
    customerPhone?: string;
    dueBackAt?: string | null;
    repairOrderId?: string | null;
    departmentRequestId?: string | null;
    notes?: string;
    mode?: 'reserve' | 'checkout';
    outOdometer?: number | null;
    fuelOut?: string | null;
    damageOut?: Array<{ area: string; note?: string; severity?: string }>;
  }) =>
    apiFetch<{ assignment: Record<string, unknown> }>('/api/loaner/assignments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchLoanerAssignment: (
    id: string,
    body: {
      action: 'checkout' | 'return' | 'cancel';
      outOdometer?: number | null;
      inOdometer?: number | null;
      fuelOut?: string | null;
      fuelIn?: string | null;
      damageOut?: Array<{ area: string; note?: string; severity?: string }>;
      damageIn?: Array<{ area: string; note?: string; severity?: string }>;
      markVehicleStatus?: 'available' | 'maintenance' | 'out_of_service';
    }
  ) =>
    apiFetch<{ assignment: Record<string, unknown> }>(`/api/loaner/assignments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** PR-M5a — voice agent ops */
  listVoiceAgentLines: () =>
    apiFetch<{
      lines: Array<{
        id: string;
        e164Number: string;
        label: string;
        provider: string;
        isActive: boolean;
        createdAt: string;
      }>;
    }>('/api/voice/lines', { cache: 'no-store' }),

  createVoiceAgentLine: (body: { e164Number: string; label?: string }) =>
    apiFetch<{ line: Record<string, unknown> }>('/api/voice/lines', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listVoiceCalls: () =>
    apiFetch<{ calls: Array<Record<string, unknown>> }>('/api/voice/calls', {
      cache: 'no-store',
    }),

  getVoiceCall: (id: string) =>
    apiFetch<{ call: Record<string, unknown> }>(`/api/voice/calls/${id}`, {
      cache: 'no-store',
    }),

  getVoiceMetrics: (days?: number) =>
    apiFetch<Record<string, unknown>>(
      `/api/voice/metrics${days ? `?days=${days}` : ''}`,
      { cache: 'no-store' }
    ),

  /** Unified Calendar & Conversation Hub */
  getHubTimeline: (params?: { q?: string; from?: string; to?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.q) query.set('q', params.q);
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    if (params?.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiFetch<{
      items: Array<Record<string, unknown>>;
      appointmentCount: number;
      callCount: number;
      stats: {
        upcomingAppointments7d: number;
        openCalls: number;
        insightsGenerated: number;
      };
      dealershipName?: string;
    }>(`/api/hub/timeline${suffix}`, { cache: 'no-store' });
  },

  createHubAppointment: (body: {
    title: string;
    startsAt: string;
    endsAt?: string | null;
    category?: 'service' | 'sales' | 'parts' | 'loaner' | 'other';
    status?: string;
    customerName?: string;
    customerPhone?: string;
    vehicleLabel?: string | null;
    notes?: string;
    advisorName?: string | null;
    source?: string;
    voiceCallId?: string | null;
  }) =>
    apiFetch<{ appointment: Record<string, unknown> }>('/api/hub/appointments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchHubAppointment: (
    id: string,
    body: Record<string, unknown> & { createShare?: boolean }
  ) =>
    apiFetch<{
      appointment: Record<string, unknown>;
      shareUrl?: string;
      shareToken?: string;
    }>(`/api/hub/appointments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  summarizeHubConversation: (callId: string) =>
    apiFetch<{ insight: Record<string, unknown> }>(
      `/api/hub/conversations/${callId}/summarize`,
      { method: 'POST', timeoutMs: 60_000, maxRetries: 0 }
    ),

  createHubAppointmentFromCall: (callId: string) =>
    apiFetch<{ appointment: Record<string, unknown> }>(
      `/api/hub/conversations/${callId}/create-appointment`,
      { method: 'POST' }
    ),

  getHubAnalytics: (days?: number) =>
    apiFetch<{
      analytics: Record<string, unknown>;
      agents: Array<{
        id: string;
        displayName: string;
        department: string;
        description: string;
      }>;
    }>(`/api/hub/analytics${days ? `?days=${days}` : ''}`, { cache: 'no-store' }),

  getHubNationalOverview: () =>
    apiFetch<{
      totals: { appointments7d: number; calls7d: number; insights7d: number };
      rooftops: Array<{
        dealershipId: string;
        dealershipName: string;
        appointments7d: number;
        calls7d: number;
        insights7d: number;
      }>;
      windowDays: number;
    }>('/api/hub/national', { cache: 'no-store' }),

  getHubAudit: (limit?: number) =>
    apiFetch<{ events: Array<Record<string, unknown>> }>(
      `/api/hub/audit${limit ? `?limit=${limit}` : ''}`,
      { cache: 'no-store' }
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