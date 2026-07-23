/**
 * P0-3 / P0-5 — Fail hard if RLS tenant registry drifts from prisma/schema.prisma.
 *
 * Any new model with dealershipId / activeDealershipId must be registered.
 * Unclassified models without platform exemption also fail.
 *
 * Usage: npm run check:rls-registry
 * Wired into: ready-to-deploy, validate:pre-deploy, CI quality job.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatRlsRegistryIssues,
  validateRlsRegistryAgainstSchema,
} from '../src/lib/apex/rlsRegistryValidation';

const PREFIX = '[merlin:rls-registry]';
const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');
const result = validateRlsRegistryAgainstSchema(schema);

if (!result.ok) {
  console.error(`${PREFIX} FAIL (hard gate — national rollout blocked)`);
  console.error(formatRlsRegistryIssues(result));
  console.error(
    `${PREFIX} Fix: update src/lib/apex/rlsTenantRegistry.ts (DIRECT / RELATION / PLATFORM),\n` +
      `  add unit isolation coverage for PII models, re-run npm run check:rls-registry.\n` +
      `  See docs/Multi-Tenant-Isolation.md and .github/pull_request_template.md.`
  );
  process.exit(1);
}

console.log(`${PREFIX} OK: ${result.summary}`);
