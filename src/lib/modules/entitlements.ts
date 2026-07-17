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
  PRODUCT_MODULE_IDS,
  SEED_ENABLED_MODULE_IDS,
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

/** Full catalog with enablement for manager UI. */
export async function listModuleStatuses(
  dealershipId: string,
  options?: { db?: DbClient }
): Promise<ModuleStatus[]> {
  const statuses = await Promise.all(
    MODULE_CATALOG.map((entry) => resolveModuleStatus(dealershipId, entry.id, options))
  );
  return statuses;
}

export interface SetDealershipModuleResult {
  moduleId: ProductModuleId;
  enabled: boolean;
  status: ModuleStatus;
  /** True when MODULES_FORCE_ENABLE still forces the module on after the write. */
  forceEnvActive: boolean;
}

/**
 * Upsert rooftop DealershipModule row (manager toggle).
 * Does not write core_story. Force-env still overrides effective status when set.
 */
export async function setDealershipModuleEnabled(
  dealershipId: string,
  moduleId: ProductModuleId,
  enabled: boolean,
  options?: { db?: DbClient; enabledById?: string | null }
): Promise<SetDealershipModuleResult> {
  const rooftopId = dealershipId.trim();
  if (!rooftopId) {
    throw new Error('dealershipId is required');
  }
  if (!(PRODUCT_MODULE_IDS as readonly string[]).includes(moduleId)) {
    throw new Error(`Unknown product module "${moduleId}"`);
  }

  const db = resolveDb(options?.db);
  const now = new Date();
  await db.dealershipModule.upsert({
    where: {
      dealershipId_moduleId: {
        dealershipId: rooftopId,
        moduleId,
      },
    },
    create: {
      dealershipId: rooftopId,
      moduleId,
      enabled,
      enabledAt: enabled ? now : null,
      enabledById: enabled ? options?.enabledById ?? null : null,
    },
    update: {
      enabled,
      enabledAt: enabled ? now : null,
      enabledById: enabled ? options?.enabledById ?? null : null,
    },
  });

  const status = await resolveModuleStatus(rooftopId, moduleId, { db });
  return {
    moduleId,
    enabled: status.enabled,
    status,
    forceEnvActive: status.source === 'force_env',
  };
}

export interface EnsureModuleDefaultsResult {
  dealershipId: string;
  created: number;
  skipped: number;
}

/**
 * Seed missing DealershipModule rows for a rooftop.
 * Never overwrites an existing rooftop row (manager choices win on re-seed).
 */
export async function ensureDealershipModuleDefaults(
  dealershipId: string,
  options?: {
    db?: DbClient;
    /** Defaults to SEED_ENABLED_MODULE_IDS. */
    enableIds?: readonly ProductModuleId[];
    enabledById?: string | null;
  }
): Promise<EnsureModuleDefaultsResult> {
  const rooftopId = dealershipId.trim();
  if (!rooftopId) {
    return { dealershipId: '', created: 0, skipped: 0 };
  }

  const db = resolveDb(options?.db);
  const enableSet = new Set<ProductModuleId>(
    options?.enableIds ?? SEED_ENABLED_MODULE_IDS
  );

  const existing = await db.dealershipModule.findMany({
    where: { dealershipId: rooftopId },
    select: { moduleId: true },
  });
  const have = new Set(existing.map((r) => r.moduleId as ProductModuleId));

  let created = 0;
  let skipped = 0;
  const now = new Date();

  for (const moduleId of PRODUCT_MODULE_IDS) {
    if (have.has(moduleId)) {
      skipped += 1;
      continue;
    }
    const enabled = enableSet.has(moduleId);
    await db.dealershipModule.create({
      data: {
        dealershipId: rooftopId,
        moduleId,
        enabled,
        enabledAt: enabled ? now : null,
        enabledById: enabled ? options?.enabledById ?? null : null,
      },
    });
    created += 1;
  }

  return { dealershipId: rooftopId, created, skipped };
}

/**
 * Apply module defaults for every dealership (seed / ops).
 * Safe to re-run — only fills missing rows.
 */
export async function ensureAllDealershipModuleDefaults(options?: {
  db?: DbClient;
  enableIds?: readonly ProductModuleId[];
}): Promise<{ rooftops: number; created: number }> {
  const db = resolveDb(options?.db);
  const dealerships = await db.dealership.findMany({ select: { id: true } });
  let created = 0;
  for (const d of dealerships) {
    const result = await ensureDealershipModuleDefaults(d.id, {
      db,
      enableIds: options?.enableIds,
    });
    created += result.created;
  }
  return { rooftops: dealerships.length, created };
}
