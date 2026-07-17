#!/usr/bin/env node
/**
 * One-shot / idempotent rename of the two seed pilot rooftops into clean team test envs.
 *
 *   seed-dealership     → Apex Test Platform   (mercedes-rooftop-v1 ops intent, D7/Xentry)
 *   seed-dealership-2   → Apex Generic Test    (generic-rooftop-v1 ops intent, neutral)
 *
 * Templates are not stored on Dealership rows; this only updates display names and prints
 * the operational template assignment for the team.
 *
 * Usage:
 *   npx tsx --import ./tests/setup/preload.mjs scripts/rename-test-rooftops.ts
 *   npx tsx --import ./tests/setup/preload.mjs scripts/rename-test-rooftops.ts --dry-run
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function loadDotEnvFile(filename: string, override = true): void {
  const full = path.join(process.cwd(), filename);
  if (!existsSync(full)) return;
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || !process.env[key]?.trim()) process.env[key] = value;
  }
}

loadDotEnvFile('.env.local', false);
loadDotEnvFile('.env.apex.local', true);
process.env.APEX_ENV = process.env.APEX_ENV || '1';
if (!process.env.PLATFORM_MODE?.trim()) process.env.PLATFORM_MODE = 'apex';
if (!process.env.NEXT_PUBLIC_PLATFORM_MODE?.trim()) {
  process.env.NEXT_PUBLIC_PLATFORM_MODE = 'apex';
}

const TARGETS = [
  {
    id: 'seed-dealership',
    name: 'Apex Test Platform',
    templateId: 'mercedes-rooftop-v1',
    storyBrand: 'mercedes' as const,
    notes: 'Mercedes-specific testing (D7 login, Xentry). Original pilot without franchise code.',
  },
  {
    id: 'seed-dealership-2',
    name: 'Apex Generic Test',
    templateId: 'generic-rooftop-v1',
    storyBrand: 'generic' as const,
    notes: 'Generic/neutral testing (apex username login, no logo). Former Newport seed rooftop.',
  },
] as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const { applyResolvedDatabaseEnv } = await import('../src/lib/apex/databaseConfig');
  applyResolvedDatabaseEnv();

  const { prisma } = await import('../src/lib/db');

  try {
    console.log(dryRun ? 'DRY RUN — no writes\n' : 'Renaming seed pilot rooftops…\n');

    for (const target of TARGETS) {
      const existing = await prisma.dealership.findUnique({
        where: { id: target.id },
        select: {
          id: true,
          name: true,
          storyBrand: true,
          dealerId: true,
          dealer: { select: { code: true, name: true } },
          _count: { select: { technicians: true } },
        },
      });

      if (!existing) {
        if (dryRun) {
          console.log(
            `[dry-run] would CREATE ${target.id} → "${target.name}" (${target.templateId}, storyBrand=${target.storyBrand})`
          );
          continue;
        }
        await prisma.dealership.create({
          data: { id: target.id, name: target.name, storyBrand: target.storyBrand },
        });
        console.log(`CREATED ${target.id}`);
        console.log(`  name:       "${target.name}"`);
        console.log(`  template:   ${target.templateId} (operational — not stored on row)`);
        console.log(`  storyBrand: ${target.storyBrand}`);
        console.log(`  note:       ${target.notes}`);
        console.log('');
        continue;
      }

      console.log(`${target.id}`);
      console.log(`  before:     "${existing.name}"`);
      console.log(`  after:      "${target.name}"`);
      console.log(`  template:   ${target.templateId} (operational — not stored on row)`);
      console.log(`  storyBrand: ${existing.storyBrand ?? '(unset)'} → ${target.storyBrand}`);
      console.log(`  dealer:     ${existing.dealer?.code ?? '(none — pilot seed)'}`);
      console.log(`  staff:      ${existing._count.technicians} technician(s)`);
      console.log(`  note:       ${target.notes}`);

      const nameOk = existing.name === target.name;
      const brandOk = existing.storyBrand === target.storyBrand;
      if (nameOk && brandOk) {
        console.log('  status:     already up to date\n');
        continue;
      }

      if (dryRun) {
        console.log('  status:     would update name/storyBrand\n');
        continue;
      }

      await prisma.dealership.update({
        where: { id: target.id },
        data: { name: target.name, storyBrand: target.storyBrand },
      });
      console.log('  status:     updated\n');
    }

    if (!dryRun) {
      console.log('Done. Team test rooftops:');
      console.log('  • Apex Test Platform  (seed-dealership)   → mercedes story pack');
      console.log('  • Apex Generic Test   (seed-dealership-2) → generic story pack');
      console.log('');
      console.log('Sign in as national owner and refresh the rooftop list to see new names.');
      console.log('Note: VITIMB / VITIVOLVO franchise rooftops are unchanged (default mercedes).');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
