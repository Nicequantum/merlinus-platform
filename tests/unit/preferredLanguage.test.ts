import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  DEFAULT_PREFERRED_LANGUAGE,
  isPreferredLanguage,
  localeToSpeechLang,
  normalizePreferredLanguage,
  preferredLanguageEnglishName,
  SUPPORTED_LOCALES,
} from '../../src/lib/i18n/locales';
import { buildInputLanguageInstruction } from '../../src/prompts/story/shared/truthRules';
import { buildStoryUserMessage } from '../../src/prompts/story/shared/buildUserMessage';
import { MERCEDES_STORY_PACK } from '../../src/prompts/story/brands/mercedes';
import type { RepairLine, RepairOrder } from '../../src/types';

const root = resolve(process.cwd());

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('preferred language helpers', () => {
  it('allowlists en and es only for Phase 1', () => {
    assert.deepEqual([...SUPPORTED_LOCALES], ['en', 'es']);
    assert.equal(isPreferredLanguage('en'), true);
    assert.equal(isPreferredLanguage('es'), true);
    assert.equal(isPreferredLanguage('fr'), false);
    assert.equal(normalizePreferredLanguage('fr'), DEFAULT_PREFERRED_LANGUAGE);
    assert.equal(normalizePreferredLanguage(null), 'en');
  });

  it('maps locales to Web Speech BCP-47 tags', () => {
    assert.equal(localeToSpeechLang('en'), 'en-US');
    assert.equal(localeToSpeechLang('es'), 'es-US');
    assert.equal(localeToSpeechLang('unknown'), 'en-US');
  });

  it('exposes English names for story prompts', () => {
    assert.equal(preferredLanguageEnglishName('es'), 'Spanish');
    assert.equal(preferredLanguageEnglishName('en'), 'English');
  });
});

describe('story input language instructions', () => {
  it('omits translate block for English', () => {
    assert.equal(buildInputLanguageInstruction('en'), '');
    assert.equal(buildInputLanguageInstruction(null), '');
  });

  it('includes Spanish translate + English output instructions', () => {
    const block = buildInputLanguageInstruction('es');
    assert.match(block, /Spanish/i);
    assert.match(block, /English/i);
    assert.match(block, /translate/i);
  });

  it('buildStoryUserMessage injects language block for es only', () => {
    const ro = {
      roNumber: 'R-1',
      vehicle: { year: '2020', make: 'MB', model: 'C300', mileageIn: '10000', mileageOut: '' },
    } as RepairOrder;
    const line = {
      lineNumber: 1,
      description: 'Noise',
      technicianNotes: 'Ruido en el motor al acelerar',
      warrantyStory: '',
      extractedData: { codes: [], faultCodes: [], guidedTests: [], measurements: [], components: [], circuits: [] },
    } as RepairLine;

    const enMsg = buildStoryUserMessage(ro, line, MERCEDES_STORY_PACK, {
      preferredLanguage: 'en',
      mode: 'generate',
    });
    assert.equal(enMsg.includes('INPUT LANGUAGE:'), false);
    assert.match(enMsg, /professional English/i);

    const esMsg = buildStoryUserMessage(ro, line, MERCEDES_STORY_PACK, {
      preferredLanguage: 'es',
      mode: 'generate',
    });
    assert.match(esMsg, /INPUT LANGUAGE:/);
    assert.match(esMsg, /Spanish/);
    assert.match(esMsg, /English/);
  });
});

describe('multilingual foundation wiring', () => {
  it('schema and migration define preferred_language', () => {
    const schema = readSrc('prisma/schema.prisma');
    assert.match(schema, /preferredLanguage/);
    assert.match(schema, /preferred_language/);
    const migration = readSrc(
      'prisma/migrations/20250719120000_technician_preferred_language/migration.sql'
    );
    assert.match(migration, /preferred_language/);
  });

  it('preferences route and generate-story use preferred language', () => {
    const prefs = readSrc('src/app/api/auth/preferences/route.ts');
    assert.match(prefs, /preferredLanguage/);
    assert.match(prefs, /preferences\.update/);
    assert.match(prefs, /skipPasswordChange/);
    const gen = readSrc(
      'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts'
    );
    assert.match(gen, /preferredLanguage/);
    assert.match(gen, /session\.preferredLanguage/);
  });

  it('session payload threads preferredLanguage', () => {
    const auth = readSrc('src/lib/auth.ts');
    assert.match(auth, /preferredLanguage/);
    const claims = readSrc('src/lib/sessionClaims.ts');
    assert.match(claims, /preferredLanguage/);
    const refresh = readSrc('src/lib/sessionRefresh.ts');
    assert.match(refresh, /preferredLanguage/);
  });

  it('VoiceInputService clones settings (does not mutate singleton)', () => {
    const src = readSrc('src/lib/voice/VoiceInputService.ts');
    assert.match(src, /Clone so setLanguage/);
    assert.match(src, /this\.settings = \{ \.\.\.settings \}/);
  });

  it('does not touch golden-path RO scan or Xentry extract routes', () => {
    // Source-presence smoke: ensure generate-story is the only story language inject site among extract paths
    const extract = readSrc('src/app/api/repair-orders/extract/route.ts');
    assert.equal(extract.includes('preferredLanguage'), false);
    const diag = readSrc('src/app/api/diagnostics/extract/route.ts');
    assert.equal(diag.includes('preferredLanguage'), false);
  });
});
