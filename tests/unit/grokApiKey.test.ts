import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('grok API key security + multi-slot routing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GROK_API_KEY;
    delete process.env.GROK_API_KEY_1;
    delete process.env.GROK_API_KEY_2;
    delete process.env.XAI_API_KEY;
    delete process.env.NEXT_PUBLIC_GROK_API_KEY;
    delete process.env.NEXT_PUBLIC_XAI_API_KEY;
    delete process.env.NEXT_PUBLIC_XAI_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('reads server-only GROK_API_KEY as default slot', async () => {
    process.env.GROK_API_KEY = 'xai-test-server-key';
    const { getGrokApiKey, resolveGrokApiKey } = await import('../../src/lib/grokApiKey.shared');
    assert.equal(getGrokApiKey(), 'xai-test-server-key');
    const r = resolveGrokApiKey('default');
    assert.equal(r.envVar, 'GROK_API_KEY');
    assert.equal(r.usedFallback, false);
  });

  test('vision prefers GROK_API_KEY_1 then falls back to GROK_API_KEY', async () => {
    process.env.GROK_API_KEY = 'xai-default';
    process.env.GROK_API_KEY_1 = 'xai-vision';
    const { resolveGrokApiKey, getGrokVisionApiKey } = await import(
      '../../src/lib/grokApiKey.shared'
    );
    assert.equal(getGrokVisionApiKey(), 'xai-vision');
    assert.equal(resolveGrokApiKey('vision').envVar, 'GROK_API_KEY_1');
    assert.equal(resolveGrokApiKey('vision').usedFallback, false);

    delete process.env.GROK_API_KEY_1;
    const fb = resolveGrokApiKey('vision');
    assert.equal(fb.key, 'xai-default');
    assert.equal(fb.envVar, 'GROK_API_KEY');
    assert.equal(fb.usedFallback, true);
  });

  test('voice prefers GROK_API_KEY_2 then GROK_API_KEY then XAI_API_KEY', async () => {
    process.env.GROK_API_KEY_2 = 'xai-voice';
    process.env.GROK_API_KEY = 'xai-default';
    process.env.XAI_API_KEY = 'xai-legacy';
    const { resolveGrokApiKey } = await import('../../src/lib/grokApiKey.shared');
    assert.equal(resolveGrokApiKey('voice').key, 'xai-voice');
    assert.equal(resolveGrokApiKey('voice').envVar, 'GROK_API_KEY_2');

    delete process.env.GROK_API_KEY_2;
    assert.equal(resolveGrokApiKey('voice').envVar, 'GROK_API_KEY');

    delete process.env.GROK_API_KEY;
    assert.equal(resolveGrokApiKey('voice').envVar, 'XAI_API_KEY');
    assert.equal(resolveGrokApiKey('voice').usedFallback, true);
  });

  test('rejects NEXT_PUBLIC_GROK_API_KEY exposure', async () => {
    process.env.GROK_API_KEY = 'xai-test-server-key';
    process.env.NEXT_PUBLIC_GROK_API_KEY = 'xai-exposed-key';
    const { getGrokApiKey } = await import('../../src/lib/grokApiKey.shared');
    assert.throws(() => getGrokApiKey(), /NEXT_PUBLIC_GROK_API_KEY/);
  });

  test('detects all forbidden public env keys', async () => {
    process.env.NEXT_PUBLIC_XAI_API_KEY = 'xai-exposed-key';
    const { FORBIDDEN_PUBLIC_GROK_ENV_KEYS, getExposedPublicGrokEnvKeys } = await import(
      '../../src/lib/grokApiKey.shared'
    );
    assert.ok(FORBIDDEN_PUBLIC_GROK_ENV_KEYS.includes('NEXT_PUBLIC_GROK_API_KEY'));
    assert.deepEqual(getExposedPublicGrokEnvKeys(), ['NEXT_PUBLIC_XAI_API_KEY']);
  });

  test('never reads NEXT_PUBLIC_GROK_API_KEY as Grok key', async () => {
    process.env.NEXT_PUBLIC_GROK_API_KEY = 'xai-exposed-key';
    const { getGrokApiKey } = await import('../../src/lib/grokApiKey.shared');
    assert.throws(() => getGrokApiKey(), /NEXT_PUBLIC_GROK_API_KEY/);
  });

  test('describeGrokKeySlot never exposes full key', async () => {
    process.env.GROK_API_KEY = 'xai-abcdefghijklmnop';
    process.env.GROK_API_KEY_1 = 'xai-vision-zzzz';
    const { describeAllGrokKeySlots } = await import('../../src/lib/grokApiKey.shared');
    const slots = describeAllGrokKeySlots();
    for (const s of slots) {
      assert.ok(!JSON.stringify(s).includes('xai-abcdefghijklmnop'));
      if (s.configured && s.keySuffix) {
        assert.equal(s.keySuffix.length, 4);
      }
    }
    const vision = slots.find((s) => s.slot === 'vision')!;
    assert.equal(vision.envVarUsed, 'GROK_API_KEY_1');
    assert.equal(vision.usedFallback, false);
  });

  test('RO extract and diagnostics use vision keySlot in source', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const grokSrc = readFileSync(resolve(process.cwd(), 'src/lib/grok.ts'), 'utf8');
    assert.match(grokSrc, /perfLabel:\s*'grok\.ro\.extract'[\s\S]*?keySlot:\s*'vision'/);
    assert.match(grokSrc, /perfLabel:\s*'grok\.diagnostics\.extract'[\s\S]*?keySlot:\s*'vision'/);
    const voiceSrc = readFileSync(resolve(process.cwd(), 'src/lib/voiceAgent/grokClient.ts'), 'utf8');
    assert.match(voiceSrc, /resolveGrokApiKey\('voice'\)/);
  });
});
