import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'public', 'tesseract');
const workerSrc = path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');
const coreDir = path.join(root, 'node_modules', 'tesseract.js-core');
const langUrl = 'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz';
const langDest = path.join(target, 'eng.traineddata.gz');

fs.mkdirSync(target, { recursive: true });

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[tesseract] missing asset: ${src}`);
    return;
  }
  fs.copyFileSync(src, dest);
}

copyIfExists(workerSrc, path.join(target, 'worker.min.js'));

for (const name of fs.readdirSync(coreDir)) {
  if (name.endsWith('.wasm') || name.endsWith('.wasm.js')) {
    copyIfExists(path.join(coreDir, name), path.join(target, name));
  }
}

if (!fs.existsSync(langDest)) {
  console.log('[tesseract] downloading eng.traineddata.gz…');
  const response = await fetch(langUrl);
  if (!response.ok) {
    throw new Error(`Failed to download tessdata: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(langDest, buffer);
}

console.log('[tesseract] assets ready in public/tesseract');