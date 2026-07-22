/**
 * Product module catalog (PR-M0+).
 *
 * core_story is intentionally excluded — the RO → evidence → AI narrative
 * pipeline is always-on and never appears as a disableable module.
 */

import type { ModuleId } from '@prisma/client';

export type ProductModuleId = ModuleId;

export const PRODUCT_MODULE_IDS: readonly ProductModuleId[] = [
  'video_mpi',
  'maintenance',
  'voice_agent',
  'voice_agent_service',
  'voice_agent_parts',
  'voice_agent_sales',
  'voice_agent_loaner',
  'calendar_hub',
  'loaner',
  'parts',
  'sales',
  'service',
  'cdk_sync',
] as const;

/** Department voice SKUs (parent: voice_agent). Pilot defaults: service + loaner. */
export const VOICE_DEPARTMENT_MODULE_IDS = [
  'voice_agent_service',
  'voice_agent_parts',
  'voice_agent_sales',
  'voice_agent_loaner',
] as const;

export type VoiceDepartmentModuleId = (typeof VOICE_DEPARTMENT_MODULE_IDS)[number];

export type VoiceDepartmentId = 'service' | 'parts' | 'sales' | 'loaner';

export const VOICE_DEPARTMENT_TO_MODULE: Record<VoiceDepartmentId, VoiceDepartmentModuleId> = {
  service: 'voice_agent_service',
  parts: 'voice_agent_parts',
  sales: 'voice_agent_sales',
  loaner: 'voice_agent_loaner',
};

export const VOICE_DEPARTMENT_DOMAIN_MODULE: Record<VoiceDepartmentId, ProductModuleId> = {
  service: 'service',
  parts: 'parts',
  sales: 'sales',
  loaner: 'loaner',
};

export function voiceDepartmentFromModuleId(
  moduleId: string
): VoiceDepartmentId | null {
  for (const [dept, mid] of Object.entries(VOICE_DEPARTMENT_TO_MODULE)) {
    if (mid === moduleId) return dept as VoiceDepartmentId;
  }
  return null;
}

export interface ModuleCatalogEntry {
  id: ProductModuleId;
  name: string;
  description: string;
}

/** Display metadata for manager/owner surfaces. */
export const MODULE_CATALOG: readonly ModuleCatalogEntry[] = [
  {
    id: 'video_mpi',
    name: 'Video MPI',
    description: 'Customer-facing multi-point video inspections, reports, and delivery.',
  },
  {
    id: 'maintenance',
    name: 'Maintenance Management',
    description: 'Cross-department facility and shop maintenance tickets.',
  },
  {
    id: 'voice_agent',
    name: 'AI Voice Agents (Sophia + specialists)',
    description:
      'Inbound phone AI (Sophia receptionist) plus department specialists. Enable per-department SKUs below. Requires Twilio DID for phone; tablet query works with Grok only.',
  },
  {
    id: 'voice_agent_service',
    name: 'Sophia · Service',
    description:
      'Service-desk voice assistant: appointments, warranty follow-up, MPI/RO guidance, scheduling handoff. Requires Service module.',
  },
  {
    id: 'voice_agent_parts',
    name: 'Sophia · Parts',
    description:
      'Parts counter voice assistant: lookup, ordering assistance, compatibility notes. Requires Parts module.',
  },
  {
    id: 'voice_agent_sales',
    name: 'Sophia · Sales',
    description:
      'Sales voice assistant: quotes, vehicle interest, appointments. Requires Sales module.',
  },
  {
    id: 'voice_agent_loaner',
    name: 'Sophia · Loaner',
    description:
      'Loaner fleet voice assistant: availability, reservations, check-in/out, returns. Requires Loaner module.',
  },
  {
    id: 'calendar_hub',
    name: 'Calendar & Conversation Hub',
    description:
      'Unified appointments timeline, AI call insights, smart booking suggestions, and customer appointment portal.',
  },
  {
    id: 'loaner',
    name: 'Loaner Car Management',
    description: 'Loaner fleet availability, assignments, returns, and damage tracking.',
  },
  {
    id: 'parts',
    name: 'Parts Department',
    description: 'Parts inbox for customer requests, VIN context, and request status.',
  },
  {
    id: 'sales',
    name: 'Sales Department',
    description: 'Sales inbox for leads and voice-routed customer requests.',
  },
  {
    id: 'service',
    name: 'Service Department',
    description: 'Service inbox for appointment and repair follow-ups from staff or voice.',
  },
  {
    id: 'cdk_sync',
    name: 'CDK Global Sync',
    description:
      'Live CDK Global API sync (requires dealer credentials). Clipboard CDK paste for RO context stays available without this module.',
  },
] as const;

const CATALOG_BY_ID = new Map(MODULE_CATALOG.map((entry) => [entry.id, entry]));

export function getModuleCatalogEntry(moduleId: ProductModuleId): ModuleCatalogEntry {
  const entry = CATALOG_BY_ID.get(moduleId);
  if (entry) return entry;
  return {
    id: moduleId,
    name: moduleId,
    description: '',
  };
}

export function isProductModuleId(value: string): value is ProductModuleId {
  return (PRODUCT_MODULE_IDS as readonly string[]).includes(value);
}

/**
 * P1-4 — Commercial provision defaults: **no paid SKUs on by default**.
 * Franchise rooftops enable modules via Manager Dashboard or contract-driven enableIds.
 * core_story is never listed (always-on, not a product module).
 * cdk_sync stays deferred (requires external credentials).
 */
export const PROVISION_DEFAULT_MODULE_IDS: readonly ProductModuleId[] = [] as const;

/**
 * Local/demo seed only — full pilot surface for staging tablets and CI integration.
 * Prefer DEMO_SEED_MODULE_IDS in seedDatabase; never use for franchise provision.
 */
export const DEMO_SEED_MODULE_IDS: readonly ProductModuleId[] = [
  'video_mpi',
  'maintenance',
  'voice_agent',
  'voice_agent_service',
  'voice_agent_loaner',
  'voice_agent_parts',
  'voice_agent_sales',
  'calendar_hub',
  'loaner',
  'parts',
  'sales',
  'service',
] as const;

/**
 * @deprecated Prefer PROVISION_DEFAULT_MODULE_IDS (commercial) or DEMO_SEED_MODULE_IDS (local).
 * Kept as alias of provision defaults so ensureDealershipModuleDefaults stays fail-closed.
 */
export const SEED_ENABLED_MODULE_IDS: readonly ProductModuleId[] = PROVISION_DEFAULT_MODULE_IDS;

/**
 * Env break-glass aliases (optional) — maps business names to ProductModuleId.
 * Prefer MODULES_FORCE_ENABLE=calendar_hub,voice_agent (canonical ids).
 * MODULE_HUB_ENABLED / MODULE_VOICE_ENABLED are accepted as soft aliases in parseForcedModules.
 */
export const MODULE_ENV_ALIASES: Record<string, ProductModuleId> = {
  MODULE_HUB_ENABLED: 'calendar_hub',
  MODULE_VOICE_ENABLED: 'voice_agent',
  hub: 'calendar_hub',
  voice: 'voice_agent',
  calendar: 'calendar_hub',
};

/** Modules deferred until external integrations are configured. */
export const DEFERRED_MODULE_IDS: readonly ProductModuleId[] = ['cdk_sync'] as const;

/**
 * Dev/ops break-glass: MODULES_FORCE_ENABLE=video_mpi,parts,sales,service
 * Never use for core_story (not a product module).
 */
export function parseForcedModules(envValue = process.env.MODULES_FORCE_ENABLE): Set<ProductModuleId> {
  const forced = new Set<ProductModuleId>();
  if (envValue?.trim()) {
    for (const raw of envValue.split(',')) {
      const id = raw.trim();
      if (isProductModuleId(id)) forced.add(id);
      else if (MODULE_ENV_ALIASES[id]) forced.add(MODULE_ENV_ALIASES[id]!);
    }
  }
  // Boolean-style aliases for ops docs / business model language
  if (isTruthyEnv(process.env.MODULE_HUB_ENABLED)) forced.add('calendar_hub');
  if (isTruthyEnv(process.env.MODULE_VOICE_ENABLED)) forced.add('voice_agent');
  return forced;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const n = value.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes' || n === 'on';
}
