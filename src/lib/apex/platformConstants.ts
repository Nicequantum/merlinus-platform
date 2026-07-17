/**
 * APEX NATIONAL PLATFORM — stable identifiers for Phase 5 schema and seed data.
 * MERLINUS SINGLE-DEALER: sentinel dealership is unused when PLATFORM_MODE=merlinus.
 */

/** Placeholder rooftop FK for owner accounts without a physical dealership. */
export const APEX_NATIONAL_DEALERSHIP_ID = '__apex_national__';

export const APEX_NATIONAL_DEALERSHIP_NAME = 'Apex National Platform';

/** AuditLog.authSource values (Phase 5 fortress auditing). */
export const AUDIT_AUTH_SOURCES = ['legacy', 'clerk', 'refresh'] as const;
export type AuditAuthSource = (typeof AUDIT_AUTH_SOURCES)[number];

/**
 * AuditLog.scopeMode / session scope values.
 * - national: platform owner (all rooftops)
 * - group: DealerGroup owner (portfolio only)
 * - dealership: entered a physical rooftop
 */
export const AUDIT_SCOPE_MODES = ['national', 'group', 'dealership'] as const;
export type AuditScopeMode = (typeof AUDIT_SCOPE_MODES)[number];