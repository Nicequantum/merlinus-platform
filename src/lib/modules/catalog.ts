/**
 * Product module catalog (PR-M0).
 *
 * core_story is intentionally excluded — the RO → evidence → AI narrative
 * pipeline is always-on and must never appear as a disableable module.
 */

import type { ModuleId } from '@prisma/client';

export type ProductModuleId = ModuleId;

export const PRODUCT_MODULE_IDS: readonly ProductModuleId[] = [
  'video_mpi',
  'maintenance',
  'voice_agent',
  'loaner',
  'parts',
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
    name: 'AI Voice Agent',
    description: 'Phone receptionist and specialist agents that route work to departments.',
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
    id: 'cdk_sync',
    name: 'CDK Global Sync',
    description: 'Live CDK Global API sync (clipboard CDK paste remains always available).',
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
 * Dev/ops break-glass: MODULES_FORCE_ENABLE=video_mpi,parts
 * Never use for core_story (not a product module).
 */
export function parseForcedModules(envValue = process.env.MODULES_FORCE_ENABLE): Set<ProductModuleId> {
  const forced = new Set<ProductModuleId>();
  if (!envValue?.trim()) return forced;
  for (const raw of envValue.split(',')) {
    const id = raw.trim();
    if (isProductModuleId(id)) forced.add(id);
  }
  return forced;
}
