/**
 * P0-5 — Fail if RLS tenant registry drifts from prisma/schema.prisma.
 *
 * Usage: npm run check:rls-registry
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
  console.error(`${PREFIX} FAIL`);
  console.error(formatRlsRegistryIssues(result));
  console.error(
    `${PREFIX} Fix: update src/lib/apex/rlsTenantRegistry.ts then re-run. See docs/Production-Readiness-Checklist.md (RLS registry).`
  );
  process.exit(1);
}

console.log(`${PREFIX} OK: ${result.summary}`);
