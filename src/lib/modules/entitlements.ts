/**
 * Module entitlement resolution (PR-M0).
 *
 * Resolution order for product modules:
 *   1. MODULES_FORCE_ENABLE env (dev/ops break-glass)
 *   2. DealershipModule row if present
 *   3. DealerGroupModule via Dealership → Dealer → DealerGroup
 *   4. Default false (opt-in)
 *
 * core_story is never a ModuleId and is always treated as enabled.
 */

import 'server-only';

import type { ModuleId, PrismaClient } from '@prisma/client';
import { getRlsDb, type RlsDbClient } from '@/lib/apex/rlsContext';
import {
  getModuleCatalogEntry,
  MODULE_CATALOG,
  parseForcedModules,
  type ProductModuleId,
} from '@/lib/modules/catalog';

export type ModuleSource = 'force_env' | 'dealership' | 'dealer_group' | 'default';

export interface ModuleStatus {
  moduleId: ProductModuleId;
  name: string;
  description: string;
  enabled: boolean;
  source: ModuleSource;
}

export class ModuleDisabledError extends Error {
  readonly code = 'MODULE_DISABLED' as const;
  readonly moduleId: ProductModuleId;

  constructor(moduleId: ProductModuleId, message?: string) {
    super(message ?? `Module "${moduleId}" is not enabled for this dealership`);
    this.name = 'ModuleDisabledError';
    this.moduleId = moduleId;
  }
}

type DbClient = RlsDbClient | PrismaClient;

function resolveDb(client?: DbClient): DbClient {
  return client ?? getRlsDb();
}

/**
 * Whether a product module is enabled for a rooftop.
 * Does not apply to core_story (always on outside this helper).
 */
export async function isModuleEnabled(
  dealershipId: string,
  moduleId: ProductModuleId | ModuleId,
  options?: { db?: DbClient }
): Promise<boolean> {
  const status = await resolveModuleStatus(dealershipId, moduleId, options);
  return status.enabled;
}

/**
 * Fail closed when a route requires a disabled module.
 * Throws ModuleDisabledError (HTTP 403 MODULE_DISABLED via withAuth).
 */
export async function assertModuleEnabled(
  dealershipId: string,
  moduleId: ProductModuleId | ModuleId,
  options?: { db?: DbClient }
): Promise<void> {
  const status = await resolveModuleStatus(dealershipId, moduleId, options);
  if (!status.enabled) {
    throw new ModuleDisabledError(moduleId);
  }
}

export async function resolveModuleStatus(
  dealershipId: string,
  moduleId: ProductModuleId | ModuleId,
  options?: { db?: DbClient }
): Promise<ModuleStatus> {
  const id = moduleId as ProductModuleId;
  const meta = getModuleCatalogEntry(id);
  const forced = parseForcedModules();
  if (forced.has(id)) {
    return {
      moduleId: id,
      name: meta.name,
      description: meta.description,
      enabled: true,
      source: 'force_env',
    };
  }

  const db = resolveDb(options?.db);
  const rooftopId = dealershipId.trim();
  if (!rooftopId) {
    return {
      moduleId: id,
      name: meta.name,
      description: meta.description,
      enabled: false,
      source: 'default',
    };
  }

  const dealershipRow = await db.dealershipModule.findUnique({
    where: {
      dealershipId_moduleId: {
        dealershipId: rooftopId,
        moduleId: id,
      },
    },
    select: { enabled: true },
  });

  if (dealershipRow) {
    return {
      moduleId: id,
      name: meta.name,
      description: meta.description,
      enabled: dealershipRow.enabled,
      source: 'dealership',
    };
  }

  const dealership = await db.dealership.findUnique({
    where: { id: rooftopId },
    select: {
      dealer: {
        select: { dealerGroupId: true },
      },
    },
  });

  const groupId = dealership?.dealer?.dealerGroupId?.trim() || '';
  if (groupId) {
    const groupRow = await db.dealerGroupModule.findUnique({
      where: {
        dealerGroupId_moduleId: {
          dealerGroupId: groupId,
          moduleId: id,
        },
      },
      select: { enabled: true },
    });
    if (groupRow) {
      return {
        moduleId: id,
        name: meta.name,
        description: meta.description,
        enabled: groupRow.enabled,
        source: 'dealer_group',
      };
    }
  }

  return {
    moduleId: id,
    name: meta.name,
    description: meta.description,
    enabled: false,
    source: 'default',
  };
}

/** Full catalog with enablement for manager read-only UI. */
export async function listModuleStatuses(
  dealershipId: string,
  options?: { db?: DbClient }
): Promise<ModuleStatus[]> {
  const statuses = await Promise.all(
    MODULE_CATALOG.map((entry) => resolveModuleStatus(dealershipId, entry.id, options))
  );
  return statuses;
}
