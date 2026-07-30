import 'server-only';

import type { Prisma, PrismaClient } from '@prisma/client';
import type { RlsContext } from '@/lib/apex/rlsContext';
import {
  buildRelationTenantWhere,
  GLOBAL_DEALERSHIP_ID,
  isGlobalCatalogModel,
  isRelationScopedModel,
  isTenantModel as registryIsTenantModel,
  listDirectDealershipModels,
  RELATION_SCOPED_MODELS,
  RLS_DENY_DEALERSHIP_ID,
} from '@/lib/apex/rlsTenantRegistry';

export { RLS_DENY_DEALERSHIP_ID, GLOBAL_DEALERSHIP_ID } from '@/lib/apex/rlsTenantRegistry';

/**
 * D1 / SQLite has no Postgres-style ROW LEVEL SECURITY.
 * This Prisma Client extension is the database-access isolation layer:
 * every query on tenant tables is rewritten to include the active dealership
 * (or an impossible deny predicate) when RLS context is enforced.
 *
 * Call sites that forget `where: { dealershipId }` still cannot cross tenants
 * when work runs inside withSessionRls / withRlsContext (enforced, non-bypass).
 *
 * Model registry (single source of truth): `src/lib/apex/rlsTenantRegistry.ts`
 * Validate against schema: `npm run check:rls-registry`
 */

/**
 * Child models without dealershipId — tenant scope via parent relation.
 * Built from RELATION_SCOPED_MODELS in rlsTenantRegistry.
 */
const RELATION_TENANT_WHERE: Record<string, (dealershipId: string) => Record<string, unknown>> =
  Object.fromEntries(
    Object.keys(RELATION_SCOPED_MODELS).map((model) => [
      model,
      (dealershipId: string) => buildRelationTenantWhere(model, dealershipId)!,
    ])
  );

const READ_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WHERE_WRITE_OPS = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

const CREATE_OPS = new Set(['create', 'createMany']);

function isTenantModel(model: string): boolean {
  return registryIsTenantModel(model);
}

function isRelationTenantModel(model: string): boolean {
  return isRelationScopedModel(model);
}

function shouldEnforce(ctx: RlsContext): boolean {
  if (ctx.bypass) return false;
  if (ctx.softOpen) return false;
  return ctx.enforced === true;
}

function resolveTenantDealershipId(ctx: RlsContext): string {
  const active = ctx.activeDealershipId?.trim() || '';
  if (active && active !== RLS_DENY_DEALERSHIP_ID) return active;
  return RLS_DENY_DEALERSHIP_ID;
}

function mergeWhere(
  existing: Record<string, unknown> | undefined,
  tenantWhere: Record<string, unknown>
): Record<string, unknown> {
  if (!existing || Object.keys(existing).length === 0) {
    return { ...tenantWhere };
  }
  // Preserve caller filters; AND with tenant predicate so neither side can drop isolation.
  return { AND: [existing, tenantWhere] };
}

/**
 * Prisma compound unique filters (e.g. dealershipId_moduleId: { dealershipId, moduleId })
 * are only valid on findUnique/upsert. findFirst requires flat field filters.
 */
function expandCompoundUniqueWhere(
  where: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!where) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (
      key.includes('_') &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      Object.values(value as Record<string, unknown>).every(
        (v) => v === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof v)
      )
    ) {
      Object.assign(out, value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Keep unique-constraint where shape for upsert/findUnique, but pin dealershipId
 * fields to the active tenant (never wrap in AND — that breaks unique where).
 */
function pinTenantOnUniqueWhere(
  where: Record<string, unknown> | undefined,
  dealershipId: string
): Record<string, unknown> {
  if (!where) {
    return { dealershipId };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (
      key.includes('_') &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      const nested = { ...(value as Record<string, unknown>) };
      if ('dealershipId' in nested) {
        nested.dealershipId = dealershipId;
      }
      out[key] = nested;
      continue;
    }
    if (key === 'dealershipId') {
      out[key] = dealershipId;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Build a findFirst-compatible where with tenant isolation. */
function buildFindFirstTenantWhere(
  where: Record<string, unknown> | undefined,
  tenantWhere: Record<string, unknown>
): Record<string, unknown> {
  const expanded = expandCompoundUniqueWhere(where);
  // Simple dealershipId pin: merge flat fields (avoids AND + compound unique).
  if (
    typeof tenantWhere.dealershipId === 'string' ||
    (tenantWhere.dealershipId &&
      typeof tenantWhere.dealershipId === 'object' &&
      'in' in (tenantWhere.dealershipId as object))
  ) {
    return { ...expanded, ...tenantWhere };
  }
  return mergeWhere(expanded, tenantWhere);
}

function buildTenantWhere(model: string, dealershipId: string): Record<string, unknown> {
  if (isRelationTenantModel(model)) {
    return RELATION_TENANT_WHERE[model]!(dealershipId);
  }
  if (isGlobalCatalogModel(model) && dealershipId !== RLS_DENY_DEALERSHIP_ID) {
    return {
      dealershipId: { in: [dealershipId, GLOBAL_DEALERSHIP_ID] },
    };
  }
  return { dealershipId };
}

function injectCreateData(
  model: string,
  data: Record<string, unknown> | undefined,
  dealershipId: string
): Record<string, unknown> {
  if (!data) return { dealershipId };
  // Relation-scoped models: do not invent dealershipId column
  if (isRelationTenantModel(model)) {
    return data;
  }
  // Never allow client to override tenant column when enforced
  if (dealershipId === RLS_DENY_DEALERSHIP_ID) {
    return { ...data, dealershipId: RLS_DENY_DEALERSHIP_ID };
  }
  // Catalog may still create global rows only via bypass
  return { ...data, dealershipId };
}

function injectCreateManyData(
  model: string,
  data: unknown,
  dealershipId: string
): unknown {
  if (isRelationTenantModel(model)) return data;
  if (Array.isArray(data)) {
    return data.map((row) =>
      injectCreateData(model, (row ?? {}) as Record<string, unknown>, dealershipId)
    );
  }
  return injectCreateData(model, (data ?? {}) as Record<string, unknown>, dealershipId);
}

/**
 * Build a Prisma client that auto-injects tenant predicates for the given RLS context.
 * When not enforcing (bypass / soft-open), returns the base client unchanged.
 */

/** Parent FK column on relation-scoped children (create-time ownership checks). */
const RELATION_PARENT_FK: Record<string, { parentModel: string; fkField: string }> = {
  RepairLine: { parentModel: 'RepairOrder', fkField: 'repairOrderId' },
  ServiceAdvisorAlias: { parentModel: 'ServiceAdvisor', fkField: 'serviceAdvisorId' },
  AdvisorWritingProfile: { parentModel: 'ServiceAdvisor', fkField: 'serviceAdvisorId' },
  PartsRequestLine: { parentModel: 'DepartmentRequest', fkField: 'departmentRequestId' },
  MaintenancePhoto: { parentModel: 'MaintenanceTicket', fkField: 'ticketId' },
  MaintenanceTicketEvent: { parentModel: 'MaintenanceTicket', fkField: 'ticketId' },
  VideoInspectionFinding: { parentModel: 'VideoInspection', fkField: 'videoInspectionId' },
  VideoInspectionShare: { parentModel: 'VideoInspection', fkField: 'videoInspectionId' },
  VideoInspectionSmsLog: { parentModel: 'VideoInspection', fkField: 'videoInspectionId' },
  VoiceTranscriptSegment: { parentModel: 'VoiceCall', fkField: 'callId' },
  UserMfa: { parentModel: 'Technician', fkField: 'technicianId' },
  DepartmentCustomizationVersion: {
    parentModel: 'DepartmentCustomization',
    fkField: 'customizationId',
  },
};

function parentFkFromCreateData(
  model: string,
  data: Record<string, unknown> | undefined
): string | null {
  const meta = RELATION_PARENT_FK[model];
  if (!meta || !data) return null;
  const direct = data[meta.fkField];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const relName = (RELATION_SCOPED_MODELS as Record<string, string>)[model];
  const rel = relName ? data[relName] : undefined;
  if (rel && typeof rel === 'object') {
    const r = rel as Record<string, unknown>;
    if (r.connect && typeof r.connect === 'object') {
      const id = (r.connect as { id?: string }).id;
      if (typeof id === 'string' && id.trim()) return id.trim();
    }
  }
  return null;
}

async function assertRelationParentInTenant(
  base: PrismaClient,
  model: string,
  data: Record<string, unknown> | undefined,
  dealershipId: string
): Promise<void> {
  if (!isRelationTenantModel(model)) return;
  if (dealershipId === RLS_DENY_DEALERSHIP_ID) {
    throw new Error(`RLS denied: cannot create ${model} without dealership context`);
  }
  const meta = RELATION_PARENT_FK[model];
  if (!meta) return;
  const parentId = parentFkFromCreateData(model, data);
  if (!parentId) {
    const relName = (RELATION_SCOPED_MODELS as Record<string, string>)[model];
    const rel = relName && data ? data[relName] : undefined;
    if (rel && typeof rel === 'object' && 'create' in (rel as object)) return;
    throw new Error(`RLS denied: ${model} create requires ${meta.fkField}`);
  }
  const delegateName = modelToDelegate(meta.parentModel);
  const delegate = (
    base as unknown as Record<string, { findFirst?: (a: unknown) => Promise<unknown> }>
  )[delegateName];
  if (!delegate?.findFirst) return;
  const parent = await delegate.findFirst({
    where: { id: parentId, dealershipId },
    select: { id: true },
  });
  if (!parent) {
    throw new Error(
      `RLS denied: ${model} parent not found in active dealership`
    );
  }
}

export function createRlsEnforcedClient(
  base: PrismaClient,
  ctx: RlsContext
): PrismaClient {
  if (!shouldEnforce(ctx)) {
    return base;
  }

  const dealershipId = resolveTenantDealershipId(ctx);

  const extended = base.$extends({
    name: 'merlinRlsTenantIsolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantModel(model)) {
            return query(args);
          }

          const tenantWhere = buildTenantWhere(model, dealershipId);
          const nextArgs = { ...(args as Record<string, unknown>) };
          const tenantDealershipId =
            typeof tenantWhere.dealershipId === 'string'
              ? tenantWhere.dealershipId
              : dealershipId;

          if (READ_OPS.has(operation) || WHERE_WRITE_OPS.has(operation)) {
            if (operation === 'upsert') {
              const upsertArgs = nextArgs as {
                where?: Record<string, unknown>;
                create?: Record<string, unknown>;
                update?: Record<string, unknown>;
              };
              // Upsert `where` must stay a unique selector — never wrap in AND.
              upsertArgs.where = pinTenantOnUniqueWhere(
                upsertArgs.where,
                tenantDealershipId
              );
              if (!isRelationTenantModel(model)) {
                upsertArgs.create = injectCreateData(
                  model,
                  upsertArgs.create,
                  dealershipId === RLS_DENY_DEALERSHIP_ID
                    ? RLS_DENY_DEALERSHIP_ID
                    : // upsert create for catalog: pin to active rooftop (not global)
                      dealershipId
                );
              }
              nextArgs.where = upsertArgs.where;
              nextArgs.create = upsertArgs.create;
            } else if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
              // Handled below — expand compound unique for findFirst rewrite.
            } else if (operation === 'update' || operation === 'delete') {
              // Prisma update/delete require WhereUniqueInput — cannot AND-wrap.
              // Handled below via updateMany/deleteMany + re-fetch.
            } else if (
              operation === 'findFirst' ||
              operation === 'findFirstOrThrow' ||
              operation === 'findMany' ||
              operation === 'count' ||
              operation === 'aggregate' ||
              operation === 'groupBy'
            ) {
              // D1 rejects some AND[dealershipId, dealershipId] shapes as invalid findMany
              // invocations (toast showed findMany even when code called findFirst).
              // Prefer flat pin when tenant filter is simple dealershipId.
              nextArgs.where = buildFindFirstTenantWhere(
                nextArgs.where as Record<string, unknown> | undefined,
                tenantWhere
              );
            } else {
              nextArgs.where = mergeWhere(
                nextArgs.where as Record<string, unknown> | undefined,
                tenantWhere
              );
            }
          }

          if (CREATE_OPS.has(operation)) {
            if (operation === 'createMany') {
              nextArgs.data = injectCreateManyData(model, nextArgs.data, dealershipId);
              if (isRelationTenantModel(model) && Array.isArray(nextArgs.data)) {
                for (const row of nextArgs.data as Record<string, unknown>[]) {
                  await assertRelationParentInTenant(base, model, row, dealershipId);
                }
              }
            } else {
              nextArgs.data = injectCreateData(
                model,
                nextArgs.data as Record<string, unknown> | undefined,
                dealershipId
              );
              await assertRelationParentInTenant(
                base,
                model,
                nextArgs.data as Record<string, unknown> | undefined,
                dealershipId
              );
            }
          }

          const delegateName = modelToDelegate(model);
          const delegate = (
            base as unknown as Record<
              string,
              {
                findFirst?: (a: unknown) => Promise<unknown>;
                findFirstOrThrow?: (a: unknown) => Promise<unknown>;
                updateMany?: (a: unknown) => Promise<{ count: number }>;
                deleteMany?: (a: unknown) => Promise<{ count: number }>;
              }
            >
          )[delegateName];

          // findUnique only accepts unique fields — rewrite to findFirst with flat tenant where.
          // Compound uniques (dealershipId_moduleId, etc.) must be expanded for findFirst.
          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            const findFirstWhere = buildFindFirstTenantWhere(
              nextArgs.where as Record<string, unknown> | undefined,
              tenantWhere
            );
            const findArgs = { ...nextArgs, where: findFirstWhere };

            if (delegate?.findFirst) {
              const method =
                operation === 'findUniqueOrThrow' ? 'findFirstOrThrow' : 'findFirst';
              return delegate[method]!(findArgs);
            }

            // Fallback: pin tenant on unique where and keep findUnique if possible
            nextArgs.where = pinTenantOnUniqueWhere(
              nextArgs.where as Record<string, unknown> | undefined,
              tenantDealershipId
            );
          }

          /**
           * update/delete: AND-wrapping unique `where` breaks Prisma validation and surfaces as
           * bogus "RO updated elsewhere" (error dumps include `updatedAt`). Rewrite to
           * updateMany/deleteMany with tenant filter, then re-fetch the row.
           */
          if (operation === 'update' && delegate?.updateMany && delegate?.findFirst) {
            const where = mergeWhere(
              expandCompoundUniqueWhere(
                nextArgs.where as Record<string, unknown> | undefined
              ),
              tenantWhere
            );
            const result = await delegate.updateMany({
              where,
              data: nextArgs.data,
            });
            if (!result.count) {
              throw Object.assign(
                new Error(`No ${model} found to update (missing or wrong tenant)`),
                { code: 'P2025' }
              );
            }
            return delegate.findFirst({
              where,
              include: nextArgs.include,
              select: nextArgs.select,
            });
          }

          if (operation === 'delete' && delegate?.deleteMany && delegate?.findFirst) {
            const where = mergeWhere(
              expandCompoundUniqueWhere(
                nextArgs.where as Record<string, unknown> | undefined
              ),
              tenantWhere
            );
            const existing = await delegate.findFirst({
              where,
              include: nextArgs.include,
              select: nextArgs.select,
            });
            if (!existing) {
              throw Object.assign(
                new Error(`No ${model} found to delete (missing or wrong tenant)`),
                { code: 'P2025' }
              );
            }
            await delegate.deleteMany({ where });
            return existing;
          }

          return query(nextArgs);
        },
      },
    },
  });

  return extended as unknown as PrismaClient;
}

/** Prisma client delegates use camelCase of the model name. */
function modelToDelegate(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export type RlsEnforcedClient = PrismaClient;

/** Test helper — exposes tenant model set for unit assertions. */
export function listDirectDealershipModelsForTests(): string[] {
  return listDirectDealershipModels();
}

export function isRlsTenantModelForTests(model: string): boolean {
  return isTenantModel(model);
}

/** Pure helper for unit tests — merge tenant where without Prisma. */
export function buildTenantWhereForTests(
  model: string,
  dealershipId: string
): Record<string, unknown> {
  return buildTenantWhere(model, dealershipId);
}

export function shouldEnforceRlsForTests(ctx: RlsContext): boolean {
  return shouldEnforce(ctx);
}

/** Pure helper for unit tests — expand compound unique where for findFirst rewrite. */
export function expandCompoundUniqueWhereForTests(
  where: Record<string, unknown> | undefined
): Record<string, unknown> {
  return expandCompoundUniqueWhere(where);
}

/** Pure helper for unit tests — findFirst tenant where used by findUnique rewrite. */
export function buildFindFirstTenantWhereForTests(
  where: Record<string, unknown> | undefined,
  tenantWhere: Record<string, unknown>
): Record<string, unknown> {
  return buildFindFirstTenantWhere(where, tenantWhere);
}
