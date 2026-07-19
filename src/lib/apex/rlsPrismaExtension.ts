import 'server-only';

import type { Prisma, PrismaClient } from '@prisma/client';
import type { RlsContext } from '@/lib/apex/rlsContext';

/**
 * D1 / SQLite has no Postgres-style ROW LEVEL SECURITY.
 * This Prisma Client extension is the database-access isolation layer:
 * every query on tenant tables is rewritten to include the active dealership
 * (or an impossible deny predicate) when RLS context is enforced.
 *
 * Call sites that forget `where: { dealershipId }` still cannot cross tenants
 * when work runs inside withSessionRls / withRlsContext (enforced, non-bypass).
 */

/** Models with a direct `dealershipId` column. */
const DIRECT_DEALERSHIP_MODELS = new Set([
  'DealershipModule',
  'Technician',
  'VideoInspection',
  'VideoUploadSession',
  'DepartmentRequest',
  'PartsLookupEvent',
  'MaintenanceTicket',
  'LoanerVehicle',
  'LoanerAssignment',
  'VoiceAgentLine',
  'VoiceCall',
  'VoiceConversation',
  'TechnicianDealership',
  'RepairOrder',
  'ServiceAdvisor',
  'AdvisorComplaintObservation',
  'UsageEvent',
  'Template',
  'KnowledgeBase',
  'AuditLog',
  'TechnicianCertifiedStory',
  'TechnicianActivityLog',
  'UsageLog',
]);

/**
 * Child models without dealershipId — tenant scope via parent relation.
 * Values are Prisma `where` fragments merged into the operation.
 */
const RELATION_TENANT_WHERE: Record<string, (dealershipId: string) => Record<string, unknown>> = {
  RepairLine: (dealershipId) => ({ repairOrder: { dealershipId } }),
  ServiceAdvisorAlias: (dealershipId) => ({ serviceAdvisor: { dealershipId } }),
  AdvisorWritingProfile: (dealershipId) => ({ serviceAdvisor: { dealershipId } }),
  PartsRequestLine: (dealershipId) => ({ departmentRequest: { dealershipId } }),
  MaintenancePhoto: (dealershipId) => ({ ticket: { dealershipId } }),
  MaintenanceTicketEvent: (dealershipId) => ({ ticket: { dealershipId } }),
  VideoInspectionFinding: (dealershipId) => ({ videoInspection: { dealershipId } }),
  VideoInspectionShare: (dealershipId) => ({ videoInspection: { dealershipId } }),
  VideoInspectionSmsLog: (dealershipId) => ({ videoInspection: { dealershipId } }),
  VoiceTranscriptSegment: (dealershipId) => ({ call: { dealershipId } }),
};

/** Catalog tables that also expose shared `__global__` rows to every rooftop. */
const GLOBAL_CATALOG_MODELS = new Set(['Template', 'KnowledgeBase']);

const GLOBAL_DEALERSHIP_ID = '__global__';

/** Impossible dealership id — default-deny when enforced without an active rooftop. */
export const RLS_DENY_DEALERSHIP_ID = '__rls_deny_no_dealership__';

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
  return DIRECT_DEALERSHIP_MODELS.has(model) || model in RELATION_TENANT_WHERE;
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
  if (model in RELATION_TENANT_WHERE) {
    return RELATION_TENANT_WHERE[model](dealershipId);
  }
  if (GLOBAL_CATALOG_MODELS.has(model) && dealershipId !== RLS_DENY_DEALERSHIP_ID) {
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
  if (model in RELATION_TENANT_WHERE) {
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
  if (model in RELATION_TENANT_WHERE) return data;
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
              if (!(model in RELATION_TENANT_WHERE)) {
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
            } else {
              nextArgs.data = injectCreateData(
                model,
                nextArgs.data as Record<string, unknown> | undefined,
                dealershipId
              );
            }
          }

          // findUnique only accepts unique fields — rewrite to findFirst with flat tenant where.
          // Compound uniques (dealershipId_moduleId, etc.) must be expanded for findFirst.
          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            const findFirstWhere = buildFindFirstTenantWhere(
              nextArgs.where as Record<string, unknown> | undefined,
              tenantWhere
            );
            const findArgs = { ...nextArgs, where: findFirstWhere };

            const delegate = (
              base as unknown as Record<
                string,
                {
                  findFirst: (a: unknown) => Promise<unknown>;
                  findFirstOrThrow: (a: unknown) => Promise<unknown>;
                }
              >
            )[modelToDelegate(model)];

            if (delegate?.findFirst) {
              const method =
                operation === 'findUniqueOrThrow' ? 'findFirstOrThrow' : 'findFirst';
              return delegate[method](findArgs);
            }

            // Fallback: pin tenant on unique where and keep findUnique if possible
            nextArgs.where = pinTenantOnUniqueWhere(
              nextArgs.where as Record<string, unknown> | undefined,
              tenantDealershipId
            );
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
  return [...DIRECT_DEALERSHIP_MODELS].sort();
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
