/**
 * Rasterize flat Apex emblem into PWA + Apple touch PNGs (reliable iOS fallback).
 * Premium emblem stays in-app via ApexLogoMark; logo.svg syncs premium SVG.
 * Run: npm run generate:icons
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * Build a multi-size .ico from PNG buffers (no third-party to-ico dependency).
 * Modern ICO entries can embed PNG payloads directly.
 * @param {Buffer[]} pngBuffers
 * @returns {Buffer}
 */
function pngsToIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const entrySize = 16;
  const dataOffset = headerSize + entrySize * count;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = dataOffset;
  for (const png of pngBuffers) {
    // IHDR width/height are big-endian at bytes 16-23
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');
const plainSvgPath = join(publicDir, 'apex-logo-plain.svg');

function syncSvgs() {
  execSync('npx tsx scripts/sync-plain-icon-svg.ts', { cwd: root, stdio: 'inherit' });
  execSync('npx tsx scripts/sync-merlin-logo-svg.ts', { cwd: root, stdio: 'inherit' });
}

const plainSvg = () => readFileSync(plainSvgPath);
const premiumSvg = () => readFileSync(join(publicDir, 'apex-logo-icon.svg'));

function svgDensityForSize(size) {
  if (size <= 180) return Math.min(256, Math.max(144, Math.round(size * 1.4)));
  return Math.min(192, Math.max(72, Math.round(size * 0.75)));
}

async function writePng(size, filename) {
  const out = join(publicDir, filename);
  await sharp(plainSvg(), { density: svgDensityForSize(size) })
    .resize(size, size, { fit: 'contain', background: { r: 4, g: 4, b: 8, alpha: 1 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(out);
  console.log(`  ${filename} (${size}×${size})`);
}

/** Maskable: logo ~78% of canvas so Android safe zone keeps the A visible when cropped. */
async function writeMaskablePng(size, filename) {
  const logoSize = Math.round(size * 0.72);
  const offset = Math.round((size - logoSize) / 2);
  const logo = await sharp(plainSvg(), { density: svgDensityForSize(logoSize) })
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const out = join(publicDir, filename);
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 4, g: 4, b: 8, alpha: 1 },
    },
  })
    .composite([{ input: logo, left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`  ${filename} (${size}×${size} maskable)`);
}

async function writeFavicon() {
  const sizes = [16, 32, 48];
  const buffers = await Promise.all(
    sizes.map((size) =>
      sharp(plainSvg(), { density: 128 })
        .resize(size, size, { fit: 'contain', background: { r: 4, g: 4, b: 8, alpha: 1 } })
        .png()
        .toBuffer()
    )
  );
  const ico = pngsToIco(buffers);
  writeFileSync(join(publicDir, 'favicon.ico'), ico);
  console.log('  favicon.ico (16, 32, 48)');
}

function syncManifestJson() {
  execSync('npx tsx scripts/sync-manifest-json.ts', { cwd: root, stdio: 'inherit' });
}

async function main() {
  console.log('Syncing Apex emblem SVGs…');
  syncSvgs();
  console.log('Generating PWA / Apple touch icons from apex-logo-plain.svg…');

  const appleSizes = [
    [180, 'apple-touch-icon.png'],
    [167, 'apple-touch-icon-167.png'],
    [152, 'apple-touch-icon-152.png'],
    [120, 'apple-touch-icon-120.png'],
  ];

  for (const [size, name] of appleSizes) {
    await writePng(size, name);
  }

  await writePng(180, 'apple-touch-icon-precomposed.png');

  await writePng(192, 'icon-192.png');
  await writePng(512, 'icon-512.png');
  await writePng(1024, 'icon-1024.png');
  await writeMaskablePng(512, 'icon-512-maskable.png');
  await writePng(167, 'icon-167.png');

  await writeFavicon();

  writeFileSync(join(publicDir, 'logo.svg'), premiumSvg());
  console.log('  logo.svg (premium Apex emblem)');

  syncManifestJson();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
