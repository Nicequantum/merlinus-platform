/**
 * Pilot data export — contract for Cloudflare → Google Cloud migration partners.
 * Schema version bumps when fields are added/removed (consumers should pin).
 */
export const PILOT_EXPORT_SCHEMA_VERSION = '1.0.0' as const;

export const PILOT_EXPORT_DATASETS = [
  'manifest',
  'platform',
  'topology',
  'staff',
  'modules',
  'usage',
  'audit',
  'provision',
  'ro_metrics',
  'ai_jobs',
  'billing',
  'selfheal',
  'health',
  'readiness',
  'capability',
] as const;

export type PilotExportDataset = (typeof PILOT_EXPORT_DATASETS)[number];

export type PilotExportAuthMode = 'owner_session' | 'service_token';

export interface PilotExportActor {
  mode: PilotExportAuthMode;
  technicianId: string | null;
  label: string;
}

export interface PilotExportPageMeta {
  schemaVersion: typeof PILOT_EXPORT_SCHEMA_VERSION;
  dataset: PilotExportDataset;
  generatedAt: string;
  authMode: PilotExportAuthMode;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
  /** Rooftop ids included in this response (tenant scope). */
  dealershipIds: string[];
  notes: string[];
}

export interface PilotExportPage<T = unknown> {
  ok: true;
  meta: PilotExportPageMeta;
  data: T[];
  /** Non-list payloads (platform, health, etc.) */
  payload?: Record<string, unknown>;
}

export interface PilotExportErrorBody {
  ok: false;
  error: string;
  code: string;
}

export const DATASET_DESCRIPTIONS: Record<
  PilotExportDataset,
  { title: string; description: string; pii: 'none' | 'minimal' | 'redacted'; paginated: boolean }
> = {
  manifest: {
    title: 'Export catalog',
    description: 'Lists all datasets, schema version, and access rules.',
    pii: 'none',
    paginated: false,
  },
  platform: {
    title: 'Platform posture',
    description: 'Version, feature flags (booleans only), binding presence — never secrets.',
    pii: 'none',
    paginated: false,
  },
  topology: {
    title: 'Tenant graph',
    description: 'DealerGroups → Dealers → Dealerships in actor scope.',
    pii: 'minimal',
    paginated: false,
  },
  staff: {
    title: 'Staff roster (redacted)',
    description: 'Roles, MFA flags, memberships — emails hashed, no password/MFA secrets.',
    pii: 'redacted',
    paginated: true,
  },
  modules: {
    title: 'Module entitlements',
    description: 'Per-rooftop module on/off (no config secrets).',
    pii: 'none',
    paginated: true,
  },
  usage: {
    title: 'Usage events (billing meters)',
    description: 'story_generated and related metering rows — no story text.',
    pii: 'none',
    paginated: true,
  },
  audit: {
    title: 'Audit trail',
    description: 'Hash-chained audit log; metadata already sanitized at write time + re-scrubbed.',
    pii: 'redacted',
    paginated: true,
  },
  provision: {
    title: 'Provision events',
    description: 'dealer.provision audits for pilot rooftop creation (hashed dealer codes).',
    pii: 'none',
    paginated: true,
  },
  ro_metrics: {
    title: 'Repair order metrics',
    description: 'RO/line counts and story flags — no encrypted customer/VIN/story fields.',
    pii: 'none',
    paginated: true,
  },
  ai_jobs: {
    title: 'AI job telemetry',
    description: 'Queue job status/progress — never resultEncrypted payloads.',
    pii: 'none',
    paginated: true,
  },
  billing: {
    title: 'National billing estimates',
    description: 'Per-rooftop story/SMS estimate summary (not invoices).',
    pii: 'none',
    paginated: false,
  },
  selfheal: {
    title: 'Self-heal reports',
    description: 'Latest nightly + morning ops reports from KV.',
    pii: 'none',
    paginated: false,
  },
  health: {
    title: 'Live health matrix',
    description: 'Dependency status (ok/warn/error) + operator messages — no secrets.',
    pii: 'none',
    paginated: false,
  },
  readiness: {
    title: 'Pilot readiness',
    description: 'evaluatePlatformReadiness checklist snapshot.',
    pii: 'none',
    paginated: false,
  },
  capability: {
    title: 'Capability matrix snapshot',
    description: 'Route/module/pilot status counts from generated matrix if present.',
    pii: 'none',
    paginated: false,
  },
};
