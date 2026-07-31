/**
 * Living capability matrix — hand overrides for pilot status.
 *
 * Automated scan fills route/module/role from source.
 * This file is the product judgment layer: pilot-in / pilot-out / deferred / ops-gated.
 *
 * Keep patterns specific; first match wins (order matters).
 */

export type PilotStatus =
  | 'pilot-core'
  | 'pilot-optional'
  | 'ops-gated'
  | 'deferred'
  | 'national-owner'
  | 'internal'
  | 'public'
  | 'unknown';

export interface CapabilityOverride {
  /** Glob-ish path match: substring of `src/app/api/.../route.ts` or route path. */
  match: string | RegExp;
  pilotStatus: PilotStatus;
  /** Short product note for matrix consumers. */
  note?: string;
}

/**
 * Ordered overrides — more specific first.
 * Paths use POSIX repo-relative route files or logical API paths.
 */
export const CAPABILITY_OVERRIDES: readonly CapabilityOverride[] = [
  // Deferred product
  { match: /cdk/i, pilotStatus: 'deferred', note: 'Live CDK API deferred — clipboard paste only' },

  // National owner
  {
    match: 'src/app/api/owner/',
    pilotStatus: 'national-owner',
    note: 'Platform / group owner console only',
  },
  {
    match: 'src/app/api/admin/',
    pilotStatus: 'pilot-optional',
    note: 'Dealership admin usage analytics',
  },

  // Core bay story (always on)
  {
    match: 'src/app/api/repair-orders',
    pilotStatus: 'pilot-core',
    note: 'Core RO + story pipeline — pilot required',
  },
  {
    match: 'src/app/api/diagnostics',
    pilotStatus: 'pilot-core',
    note: 'Diagnostic evidence extraction',
  },
  {
    match: 'src/app/api/images',
    pilotStatus: 'pilot-core',
    note: 'Private evidence blobs',
  },
  {
    match: 'src/app/api/upload',
    pilotStatus: 'pilot-core',
    note: 'Bay photo upload',
  },
  {
    match: 'src/app/api/templates',
    pilotStatus: 'pilot-core',
    note: 'Story / customer-pay templates',
  },
  {
    match: 'src/app/api/auth/',
    pilotStatus: 'pilot-core',
    note: 'Auth, MFA, session',
  },
  {
    match: 'src/app/api/session/',
    pilotStatus: 'pilot-core',
    note: 'Bay session warmup',
  },
  {
    match: 'src/app/api/health',
    pilotStatus: 'pilot-core',
    note: 'Manager health matrix',
  },
  {
    match: 'src/app/api/status',
    pilotStatus: 'public',
    note: 'Public liveness',
  },
  {
    match: 'src/app/api/manager/',
    pilotStatus: 'pilot-core',
    note: 'Manager control center / MFA admin / encryption',
  },
  {
    match: 'src/app/api/audit-logs',
    pilotStatus: 'pilot-core',
    note: 'Manager audit trail',
  },
  {
    match: 'src/app/api/companion/',
    pilotStatus: 'pilot-core',
    note: 'Desktop companion sync (LWW)',
  },
  {
    match: 'src/app/api/technicians',
    pilotStatus: 'pilot-core',
    note: 'Staff management',
  },
  {
    match: 'src/app/api/users',
    pilotStatus: 'pilot-core',
    note: 'User admin',
  },
  {
    match: 'src/app/api/consent',
    pilotStatus: 'pilot-core',
  },
  {
    match: 'src/app/api/legal-disclaimer',
    pilotStatus: 'pilot-core',
  },
  {
    match: 'src/app/api/modules',
    pilotStatus: 'pilot-core',
    note: 'Entitlement toggles — keep non-core off in pilot',
  },
  {
    match: 'src/app/api/queue/',
    pilotStatus: 'ops-gated',
    note: 'Async AI jobs — requires queue consumer healthy',
  },
  {
    match: 'src/app/api/ai-jobs',
    pilotStatus: 'ops-gated',
    note: 'Job status — requires durable AI path',
  },
  {
    match: 'src/app/api/grok/',
    pilotStatus: 'ops-gated',
    note: 'Grok proxy — server key required',
  },
  {
    match: 'src/app/api/vin/',
    pilotStatus: 'pilot-optional',
  },
  {
    match: 'src/app/api/advisors',
    pilotStatus: 'pilot-optional',
    note: 'Service advisor metrics — some require DMS feed',
  },
  {
    match: 'src/app/api/dashboard',
    pilotStatus: 'pilot-optional',
  },
  {
    match: 'src/app/api/knowledge-base',
    pilotStatus: 'pilot-optional',
  },

  // Product modules (opt-in after core pilot)
  {
    match: 'src/app/api/maintenance/',
    pilotStatus: 'pilot-optional',
    note: 'Requires maintenance module',
  },
  {
    match: 'src/app/api/loaner/',
    pilotStatus: 'pilot-optional',
    note: 'Requires loaner module',
  },
  {
    match: 'src/app/api/department-requests',
    pilotStatus: 'pilot-optional',
    note: 'Parts/sales/service inboxes',
  },
  {
    match: 'src/app/api/hub/',
    pilotStatus: 'pilot-optional',
    note: 'Requires calendar_hub',
  },
  {
    match: 'src/app/api/voice/',
    pilotStatus: 'pilot-optional',
    note: 'Requires voice_agent + Twilio ops',
  },
  {
    match: 'src/app/api/public/video',
    pilotStatus: 'pilot-optional',
    note: 'Customer video share links',
  },
  {
    match: 'src/app/api/public/hub',
    pilotStatus: 'pilot-optional',
  },
  {
    match: 'src/app/api/public/',
    pilotStatus: 'public',
  },
  {
    match: 'src/app/api/webhooks/',
    pilotStatus: 'ops-gated',
    note: 'External webhooks — signature verified',
  },
  {
    match: 'src/app/api/setup/',
    pilotStatus: 'internal',
    note: 'Bootstrap only — blocked in production without SETUP_SECRET',
  },
];

export function resolvePilotStatus(
  routeFile: string,
  moduleId: string | null
): { pilotStatus: PilotStatus; note?: string } {
  if (moduleId === 'cdk_sync') {
    return { pilotStatus: 'deferred', note: 'Live CDK API deferred' };
  }
  for (const o of CAPABILITY_OVERRIDES) {
    if (typeof o.match === 'string') {
      if (routeFile.includes(o.match)) {
        return { pilotStatus: o.pilotStatus, note: o.note };
      }
    } else if (o.match.test(routeFile)) {
      return { pilotStatus: o.pilotStatus, note: o.note };
    }
  }
  if (moduleId) {
    return {
      pilotStatus: 'pilot-optional',
      note: `Gated by module ${moduleId}`,
    };
  }
  return { pilotStatus: 'unknown' };
}

export const PILOT_STATUS_LEGEND: Record<PilotStatus, string> = {
  'pilot-core': 'Required for first MB pilot (core warranty story)',
  'pilot-optional': 'Enable only if contracted / journey-proven',
  'ops-gated': 'Needs Worker secrets / queue / external service healthy',
  deferred: 'Not shipping — do not sell as live',
  'national-owner': 'National / group owner only',
  internal: 'Bootstrap / internal — not bay-facing',
  public: 'Unauthenticated or public token surface',
  unknown: 'Not classified — review before pilot',
};
