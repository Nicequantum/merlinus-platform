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
  'calendar_hub',
  'loaner',
  'parts',
  'sales',
  'service',
  'cdk_sync',
] as const;

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
      'Inbound phone AI (Sophia receptionist and department specialists). Requires Twilio DID configuration.',
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
 * Modules enabled by default for seed / newly provisioned rooftops.
 * Does not include cdk_sync (requires external CDK credentials — PR-M7).
 * core_story is never listed (always-on, not a product module).
 */
export const SEED_ENABLED_MODULE_IDS: readonly ProductModuleId[] = [
  'video_mpi',
  'maintenance',
  'voice_agent',
  'calendar_hub',
  'loaner',
  'parts',
  'sales',
  'service',
] as const;

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
