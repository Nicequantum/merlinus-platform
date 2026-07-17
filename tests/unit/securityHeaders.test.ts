import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { isCrossOriginRequest } from '@/lib/securityHeaders';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('security headers and CORS', () => {
  it('detects cross-origin requests by Origin header', () => {
    assert.equal(isCrossOriginRequest(null, 'https://merlin.example.com'), false);
    assert.equal(
      isCrossOriginRequest('https://merlin.example.com', 'https://merlin.example.com'),
      false
    );
    assert.equal(
      isCrossOriginRequest('https://evil.example.com', 'https://merlin.example.com'),
      true
    );
    assert.equal(isCrossOriginRequest('not-a-url', 'https://merlin.example.com'), true);
  });

  it('CSP is centralized and blocks eval plus third-party frames', () => {
    const policy = readSrc('security-policy.mjs');
    const middleware = readSrc('src/middleware.ts');
    const nextConfig = readSrc('next.config.mjs');

    assert.ok(policy.includes('frame-src https://*.clerk.accounts.dev'));
    assert.ok(policy.includes('https://challenges.cloudflare.com'));
    assert.ok(policy.includes("media-src 'self' blob:"));
    assert.equal(policy.includes('unsafe-eval'), false);
    assert.ok(middleware.includes("from '../security-policy.mjs'"));
    assert.ok(nextConfig.includes("from './security-policy.mjs'"));
    assert.ok(middleware.includes('denyCrossOriginApi'));
    assert.ok(middleware.includes('isCrossOriginRequest'));
    assert.ok(middleware.includes('isMerlinPublicPath'));
  });

  it('adds cross-origin isolation and CORP headers', () => {
    const policy = readSrc('security-policy.mjs');
    assert.ok(policy.includes('Cross-Origin-Opener-Policy'));
    assert.ok(policy.includes('Cross-Origin-Resource-Policy'));
    assert.ok(policy.includes('X-Permitted-Cross-Domain-Policies'));
    assert.ok(policy.includes('same-origin'));
  });
});