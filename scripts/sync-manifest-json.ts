import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPwaManifest } from '../src/lib/pwaManifest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestBody = `${JSON.stringify(getPwaManifest(), null, 2)}\n`;

for (const filename of ['manifest.json', 'manifest.webmanifest'] as const) {
  const outPath = join(root, 'public', filename);
  writeFileSync(outPath, manifestBody, 'utf8');
  console.log(`Synced public/${filename} from getPwaManifest()`);
}