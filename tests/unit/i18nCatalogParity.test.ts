import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd(), 'src/i18n/locales');

function loadKeys(locale: string, ns: string): string[] {
  const raw = readFileSync(resolve(root, locale, `${ns}.json`), 'utf8');
  const obj = JSON.parse(raw) as Record<string, unknown>;
  return Object.keys(obj).sort();
}

describe('i18n catalog parity (en vs es)', () => {
  const enFiles = readdirSync(resolve(root, 'en')).filter((f) => f.endsWith('.json'));
  const esFiles = readdirSync(resolve(root, 'es')).filter((f) => f.endsWith('.json'));

  it('has matching namespace files', () => {
    assert.deepEqual(enFiles.sort(), esFiles.sort());
  });

  for (const file of enFiles) {
    const ns = file.replace(/\.json$/, '');
    it(`${ns}: every en key exists in es`, () => {
      const enKeys = loadKeys('en', ns);
      const esKeys = loadKeys('es', ns);
      assert.deepEqual(esKeys, enKeys, `Key mismatch in namespace ${ns}`);
    });
  }
});
