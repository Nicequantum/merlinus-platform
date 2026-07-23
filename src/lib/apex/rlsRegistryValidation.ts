/**
 * P0-5 — Validate RLS tenant registry against prisma/schema.prisma.
 * Pure functions (no DB) for unit tests, startup warn, and deploy gates.
 */

import {
  DIRECT_DEALERSHIP_MODELS,
  GLOBAL_CATALOG_MODELS,
  isPlatformNonTenantModel,
  listDirectDealershipModels,
  listRelationScopedModels,
  PLATFORM_NON_TENANT_MODELS,
  RELATION_SCOPED_MODELS,
} from '@/lib/apex/rlsTenantRegistry';

export interface ParsedPrismaModel {
  name: string;
  /** Scalar field names declared on the model body. */
  fields: string[];
  hasDealershipId: boolean;
}

export interface RlsRegistryValidationIssue {
  code:
    | 'missing_direct'
    | 'extra_direct'
    | 'missing_relation'
    | 'extra_relation'
    | 'global_not_direct'
    | 'overlap_direct_relation'
    | 'platform_has_dealership'
    | 'unclassified_model'
    | 'tenant_field_unregistered'
    | 'relation_parent_invalid';
  model: string;
  message: string;
}

/** Scalar field names that imply rooftop tenancy and require registry classification. */
export const TENANT_SCALAR_FIELDS = [
  'dealershipId',
  'activeDealershipId',
] as const;

export interface RlsRegistryValidationResult {
  ok: boolean;
  models: ParsedPrismaModel[];
  issues: RlsRegistryValidationIssue[];
  summary: string;
}

/**
 * Minimal Prisma schema model parser (field names + dealershipId detection).
 * Sufficient for registry completeness; not a full Prisma AST.
 */
export function parsePrismaModelsFromSchema(schemaSource: string): ParsedPrismaModel[] {
  const models: ParsedPrismaModel[] = [];
  let current: ParsedPrismaModel | null = null;

  for (const rawLine of schemaSource.split(/\r?\n/)) {
    const line = rawLine.trim();
    const modelMatch = rawLine.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      current = { name: modelMatch[1]!, fields: [], hasDealershipId: false };
      continue;
    }
    if (current && rawLine.startsWith('}')) {
      models.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    // Skip comments / attributes / empties
    if (!line || line.startsWith('//') || line.startsWith('@@') || line.startsWith('@')) {
      continue;
    }
    // Field: name Type ...
    const fieldMatch = line.match(/^(\w+)\s+/);
    if (!fieldMatch) continue;
    const fieldName = fieldMatch[1]!;
    // Skip enum-like or relation-only noise already covered
    current.fields.push(fieldName);
    if (fieldName === 'dealershipId' || fieldName === 'activeDealershipId') {
      current.hasDealershipId = true;
    }
  }

  return models;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * Compare registry sets to schema models.
 * Fail closed on any model with dealershipId not in DIRECT, and any non-platform
 * model without dealershipId not in RELATION (or mis-registered).
 */
export function validateRlsRegistryAgainstSchema(
  schemaSource: string
): RlsRegistryValidationResult {
  const models = parsePrismaModelsFromSchema(schemaSource);
  const issues: RlsRegistryValidationIssue[] = [];
  const schemaNames = new Set(models.map((m) => m.name));
  const withDealership = new Set(
    models.filter((m) => m.hasDealershipId).map((m) => m.name)
  );
  const withoutDealership = new Set(
    models.filter((m) => !m.hasDealershipId).map((m) => m.name)
  );

  const direct = new Set(DIRECT_DEALERSHIP_MODELS as readonly string[]);
  const relation = new Set(Object.keys(RELATION_SCOPED_MODELS));
  const platform = new Set(PLATFORM_NON_TENANT_MODELS as readonly string[]);
  const globalCatalog = new Set(GLOBAL_CATALOG_MODELS as readonly string[]);

  // Global catalog must be direct tenant models
  for (const name of globalCatalog) {
    if (!direct.has(name)) {
      issues.push({
        code: 'global_not_direct',
        model: name,
        message: `GLOBAL_CATALOG model "${name}" must also be in DIRECT_DEALERSHIP_MODELS`,
      });
    }
  }

  // No overlap direct vs relation
  for (const name of direct) {
    if (relation.has(name)) {
      issues.push({
        code: 'overlap_direct_relation',
        model: name,
        message: `"${name}" cannot be both DIRECT and RELATION scoped`,
      });
    }
  }

  // Schema has dealershipId → must be DIRECT
  for (const name of withDealership) {
    if (!direct.has(name)) {
      issues.push({
        code: 'missing_direct',
        model: name,
        message: `Schema model "${name}" has dealershipId but is not in DIRECT_DEALERSHIP_MODELS — cross-tenant risk`,
      });
    }
  }

  // DIRECT registry entry must exist in schema with dealershipId
  for (const name of direct) {
    if (!schemaNames.has(name)) {
      issues.push({
        code: 'extra_direct',
        model: name,
        message: `DIRECT_DEALERSHIP_MODELS lists "${name}" but it is missing from schema.prisma`,
      });
      continue;
    }
    if (!withDealership.has(name)) {
      issues.push({
        code: 'extra_direct',
        model: name,
        message: `DIRECT_DEALERSHIP_MODELS lists "${name}" but schema has no dealershipId field`,
      });
    }
  }

  // RELATION registry must exist and must NOT use direct dealershipId column
  for (const name of relation) {
    if (!schemaNames.has(name)) {
      issues.push({
        code: 'extra_relation',
        model: name,
        message: `RELATION_SCOPED_MODELS lists "${name}" but it is missing from schema.prisma`,
      });
      continue;
    }
    if (withDealership.has(name)) {
      issues.push({
        code: 'extra_relation',
        model: name,
        message: `"${name}" has dealershipId — register as DIRECT, not RELATION`,
      });
    }
  }

  // Platform exempt models must not have dealershipId (would need DIRECT)
  for (const name of platform) {
    if (withDealership.has(name)) {
      issues.push({
        code: 'platform_has_dealership',
        model: name,
        message: `PLATFORM_NON_TENANT model "${name}" has dealershipId — move to DIRECT or fix schema`,
      });
    }
  }

  // Every schema model must be classified
  for (const model of models) {
    const name = model.name;
    if (direct.has(name) || relation.has(name) || platform.has(name)) {
      continue;
    }
    if (model.hasDealershipId) {
      // already reported as missing_direct
      continue;
    }
    issues.push({
      code: 'unclassified_model',
      model: name,
      message:
        `Schema model "${name}" is not in DIRECT, RELATION, or PLATFORM_NON_TENANT registries. ` +
        'Add it to RELATION_SCOPED_MODELS (child of tenant row) or PLATFORM_NON_TENANT_MODELS (global/platform).',
    });
  }

  // Hard fail: any tenant scalar on an unregistered model (P0-3 mitigation)
  for (const model of models) {
    const tenantFields = model.fields.filter((f) =>
      (TENANT_SCALAR_FIELDS as readonly string[]).includes(f)
    );
    if (tenantFields.length === 0) continue;
    if (direct.has(model.name) || relation.has(model.name)) continue;
    issues.push({
      code: 'tenant_field_unregistered',
      model: model.name,
      message:
        `Schema model "${model.name}" has tenant field(s) [${tenantFields.join(', ')}] ` +
        'but is not in DIRECT_DEALERSHIP_MODELS (or is mis-registered). Register before merge.',
    });
  }

  // Relation parent field should exist as a field name on the model (best-effort)
  for (const [modelName, parentField] of Object.entries(RELATION_SCOPED_MODELS)) {
    const model = models.find((m) => m.name === modelName);
    if (!model) continue;
    if (!model.fields.includes(parentField)) {
      issues.push({
        code: 'extra_relation',
        model: modelName,
        message: `RELATION parent field "${parentField}" not found on model "${modelName}" in schema`,
      });
      continue;
    }
    // Parent relation should resolve to a DIRECT or PLATFORM model name (PascalCase of field is weak;
    // require parent field type model exists as registered DIRECT if it has dealershipId).
    // Best-effort: if a schema model exists with that exact name (capitalized field), check registry.
    const parentModelGuess =
      parentField.charAt(0).toUpperCase() + parentField.slice(1);
    if (schemaNames.has(parentModelGuess)) {
      if (
        !direct.has(parentModelGuess) &&
        !relation.has(parentModelGuess) &&
        !platform.has(parentModelGuess)
      ) {
        issues.push({
          code: 'relation_parent_invalid',
          model: modelName,
          message:
            `RELATION parent "${parentField}" → model "${parentModelGuess}" is not registered ` +
            '(DIRECT / RELATION / PLATFORM). Register parent first.',
        });
      }
    }
  }

  const ok = issues.length === 0;
  const summary = ok
    ? `RLS registry OK — ${listDirectDealershipModels().length} direct, ${listRelationScopedModels().length} relation, ${PLATFORM_NON_TENANT_MODELS.length} platform; schema models=${models.length}`
    : `RLS registry FAIL — ${issues.length} issue(s): ${sortedUnique(issues.map((i) => i.model)).join(', ')}`;

  return { ok, models, issues, summary };
}

export function formatRlsRegistryIssues(result: RlsRegistryValidationResult): string {
  if (result.ok) return result.summary;
  const lines = [result.summary, ...result.issues.map((i) => `  [${i.code}] ${i.message}`)];
  return lines.join('\n');
}
