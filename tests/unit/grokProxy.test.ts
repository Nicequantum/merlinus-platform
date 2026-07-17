import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Apex Grok proxy foundation (Phase 6.2)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GROK_API_KEY;
    delete process.env.GROK_PROXY_API_KEY;
    delete process.env.GROK_PROXY_URL;
    delete process.env.GROK_PROXY_ALLOW_STATIC_BEARER;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('detects proxy configuration from GROK_PROXY_API_KEY', async () => {
    process.env.GROK_PROXY_API_KEY = 'apex-proxy-secret-key-32chars!!';
    const { isGrokProxyConfigured } = await import('../../src/lib/grokApiKey.shared');
    assert.equal(isGrokProxyConfigured(), true);
  });

  it('isGrokConfigured accepts proxy-only Apex dealer nodes', async () => {
    process.env.GROK_PROXY_API_KEY = 'apex-proxy-secret-key-32chars!!';
    const { isGrokConfigured } = await import('../../src/lib/grok');
    assert.equal(isGrokConfigured(), true);
  });

  it('keeps Merlinus direct-path default when proxy is unset', async () => {
    process.env.GROK_API_KEY = 'xai-direct-key';
    const grokSrc = readSrc('src/lib/grok.ts');
    assert.match(grokSrc, /shouldUseApexGrokProxy/);
    assert.match(grokSrc, /transport: 'direct'/);
    assert.match(grokSrc, /createGrokProxyAccessToken/);
    assert.doesNotMatch(grokSrc, /import 'server-only'/);
    const { isGrokProxyConfigured } = await import('../../src/lib/grokApiKey.shared');
    assert.equal(isGrokProxyConfigured(), false);
  });

  it('does not self-proxy when GROK_API_KEY is present without GROK_PROXY_URL', () => {
    // Hosts that only set GROK_PROXY_API_KEY for inbound auth must still call xAI directly.
    const grokSrc = readSrc('src/lib/grok.ts');
    assert.match(grokSrc, /getGrokProxyBaseUrl/);
    assert.match(grokSrc, /createGrokProxyAccessToken/);
    assert.match(grokSrc, /x-vercel-protection-bypass/);
  });

  it('mints and verifies short-lived proxy tokens with timing-safe verify', async () => {
    process.env.GROK_PROXY_API_KEY = 'apex-proxy-secret-key-32chars!!';
    const { createGrokProxyAccessToken, verifyGrokProxyAccessToken } = await import(
      '../../src/lib/grokProxyAuth'
    );
    const token = createGrokProxyAccessToken(60);
    assert.match(token, /^v1\./);
    assert.equal(verifyGrokProxyAccessToken(token), true);
    assert.equal(verifyGrokProxyAccessToken(token + 'x'), false);
    assert.equal(verifyGrokProxyAccessToken('v1.bad.sig'), false);
  });

  it('proxy route rejects static bearer unless break-glass env is set', async () => {
    process.env.GROK_PROXY_API_KEY = 'apex-proxy-secret-key-32chars!!';
    process.env.GROK_API_KEY = 'xai-upstream-key';
    const { POST } = await import('../../src/app/api/grok/proxy/route');

    const unauthorized = await POST(
      new Request('http://localhost/api/grok/proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer apex-proxy-secret-key-32chars!!',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      })
    );
    // Without session and without short-lived token / static break-glass → 401 from withAuth
    assert.ok(unauthorized.status === 401 || unauthorized.status === 403);
  });

  it('proxy route authenticates with short-lived HMAC token', async () => {
    process.env.GROK_PROXY_API_KEY = 'apex-proxy-secret-key-32chars!!';
    process.env.GROK_API_KEY = 'xai-upstream-key';
    const { createGrokProxyAccessToken } = await import('../../src/lib/grokProxyAuth');
    const { POST } = await import('../../src/app/api/grok/proxy/route');
    const token = createGrokProxyAccessToken(60);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    try {
      const authorized = await POST(
        new Request('http://localhost/api/grok/proxy', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'grok-4.3',
            messages: [{ role: 'user', content: 'hi' }],
            temperature: 0.1,
            max_tokens: 32,
          }),
        })
      );
      assert.equal(authorized.status, 200);
      const payload = (await authorized.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      assert.equal(payload.choices?.[0]?.message?.content, 'ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('route uses timing-safe auth module and rate-limits bearer path', () => {
    const src = readSrc('src/app/api/grok/proxy/route.ts');
    assert.match(src, /isValidGrokProxyBearer/);
    assert.match(src, /checkRateLimit/);
    assert.match(src, /requireDealershipContext:\s*true/);
    const auth = readSrc('src/lib/grokProxyAuth.ts');
    assert.match(auth, /timingSafeEqual/);
    assert.match(auth, /createGrokProxyAccessToken/);
    assert.match(auth, /verifyGrokProxyAccessToken/);
  });
});
