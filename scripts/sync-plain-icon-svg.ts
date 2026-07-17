/**
 * Write flat Apex emblem SVG for PWA / Apple touch / favicon rasterization.
 * Run: npx tsx scripts/sync-plain-icon-svg.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderApexPlainStaticSvg } from '../src/lib/apexLogo/renderStaticSvg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

const svg = `${renderApexPlainStaticSvg()}\n`;
writeFileSync(join(publicDir, 'apex-logo-plain.svg'), svg, 'utf8');
// Legacy filenames — same Apex art so old caches / links never show Mercedes.
writeFileSync(join(publicDir, 'mercedes-star-plain.svg'), svg, 'utf8');
console.log('Synced public/apex-logo-plain.svg (+ legacy mercedes-star-plain.svg → Apex)');
