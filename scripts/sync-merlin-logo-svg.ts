/**
 * Write premium in-app Apex logo SVG for static assets (logo.svg / icon SVG).
 * Run: npx tsx scripts/sync-merlin-logo-svg.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderApexPremiumStaticSvg } from '../src/lib/apexLogo/renderStaticSvg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

const svg = `${renderApexPremiumStaticSvg()}\n`;
writeFileSync(join(publicDir, 'apex-logo-icon.svg'), svg, 'utf8');
writeFileSync(join(publicDir, 'logo.svg'), svg, 'utf8');
// Legacy filename — Apex content only.
writeFileSync(join(publicDir, 'mercedes-star-icon.svg'), svg, 'utf8');
console.log('Synced public/apex-logo-icon.svg, logo.svg (+ legacy mercedes-star-icon.svg → Apex)');
