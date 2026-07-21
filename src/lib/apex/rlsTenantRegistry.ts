/**
 * P0-5 — Single source of truth for app-layer multi-tenant isolation.
 *
 * D1/SQLite has no Postgres RLS. Every Prisma model that holds rooftop data
 * must appear here so `createRlsEnforcedClient` rewrites queries with a
 * dealership predicate (or parent relation predicate).
 *
 * When you add a Prisma model:
 *   1. If it has `dealershipId` → add to DIRECT_DEALERSHIP_MODELS
 *   2. If it is a child of a tenant row (no dealershipId) → add to RELATION_SCOPED_MODELS
 *   3. If it is platform/global hierarchy only → add to PLATFORM_NON_TENANT_MODELS
 *   4. Run `npm run check:rls-registry` and add/adjust unit tests
 *
 * Catalog models that also serve `__global__` rows go in GLOBAL_CATALOG_MODELS
 * (must also be in DIRECT_DEALERSHIP_MODELS).
 */

/** Models with a direct `dealershipId` column — auto-injected on read/write. */
export const DIRECT_DEALERSHIP_MODELS = [
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
  'ServiceAppointment',
  'ConversationInsight',
  'HubAuditEvent',
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
  'AiJob',
  'PasswordRecoveryToken',
] as const;

export type DirectDealershipModel = (typeof DIRECT_DEALERSHIP_MODELS)[number];

/**
 * Child models without dealershipId — tenant scope via parent relation.
 * Value is the Prisma relation field name that points at a parent with dealershipId.
 * Enforced where becomes: { [parentRelation]: { dealershipId } }
 */
export const RELATION_SCOPED_MODELS = {
  RepairLine: 'repairOrder',
  ServiceAdvisorAlias: 'serviceAdvisor',
  AdvisorWritingProfile: 'serviceAdvisor',
  PartsRequestLine: 'departmentRequest',
  MaintenancePhoto: 'ticket',
  MaintenanceTicketEvent: 'ticket',
  VideoInspectionFinding: 'videoInspection',
  VideoInspectionShare: 'videoInspection',
  VideoInspectionSmsLog: 'videoInspection',
  VoiceTranscriptSegment: 'call',
} as const;

export type RelationScopedModel = keyof typeof RELATION_SCOPED_MODELS;

/** Catalog tables that also expose shared `__global__` rows to every rooftop. */
export const GLOBAL_CATALOG_MODELS = ['Template', 'KnowledgeBase'] as const;

export type GlobalCatalogModel = (typeof GLOBAL_CATALOG_MODELS)[number];

/**
 * Platform / hierarchy models intentionally outside rooftop tenant RLS.
 * These must not carry silent dealership-scoped PII without an explicit design.
 */
export const PLATFORM_NON_TENANT_MODELS = [
  'DealerGroup',
  'DealerGroupMembership',
  'Dealer',
  'Dealership',
  'DealerGroupModule',
  /** Auth refresh tokens — bound to technician id, not dealership column. */
  'SessionRefreshToken',
] as const;

export type PlatformNonTenantModel = (typeof PLATFORM_NON_TENANT_MODELS)[number];

export const GLOBAL_DEALERSHIP_ID = '__global__';

/** Impossible dealership id — default-deny when enforced without an active rooftop. */
export const RLS_DENY_DEALERSHIP_ID = '__rls_deny_no_dealership__';

export function isDirectDealershipModel(model: string): boolean {
  return (DIRECT_DEALERSHIP_MODELS as readonly string[]).includes(model);
}

export function isRelationScopedModel(model: string): model is RelationScopedModel {
  return Object.prototype.hasOwnProperty.call(RELATION_SCOPED_MODELS, model);
}

export function isTenantModel(model: string): boolean {
  return isDirectDealershipModel(model) || isRelationScopedModel(model);
}

export function isGlobalCatalogModel(model: string): boolean {
  return (GLOBAL_CATALOG_MODELS as readonly string[]).includes(model);
}

export function isPlatformNonTenantModel(model: string): boolean {
  return (PLATFORM_NON_TENANT_MODELS as readonly string[]).includes(model);
}

/** Build Prisma where fragment for relation-scoped child models. */
export function buildRelationTenantWhere(
  model: string,
  dealershipId: string
): Record<string, unknown> | null {
  if (!isRelationScopedModel(model)) return null;
  const parent = RELATION_SCOPED_MODELS[model];
  return { [parent]: { dealershipId } };
}

/** Build tenant where for any registered tenant model. */
export function buildRegistryTenantWhere(
  model: string,
  dealershipId: string
): Record<string, unknown> {
  if (isRelationScopedModel(model)) {
    return buildRelationTenantWhere(model, dealershipId)!;
  }
  if (isGlobalCatalogModel(model) && dealershipId !== RLS_DENY_DEALERSHIP_ID) {
    return {
      dealershipId: { in: [dealershipId, GLOBAL_DEALERSHIP_ID] },
    };
  }
  return { dealershipId };
}

export function listDirectDealershipModels(): string[] {
  return [...DIRECT_DEALERSHIP_MODELS].sort();
}

export function listRelationScopedModels(): string[] {
  return Object.keys(RELATION_SCOPED_MODELS).sort();
}

export function listAllRegisteredTenantModels(): string[] {
  return [...listDirectDealershipModels(), ...listRelationScopedModels()].sort();
}
