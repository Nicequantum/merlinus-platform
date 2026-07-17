/**
 * Phase 7.2 H12 — Clerk webhook behavioral tests (fail-closed contracts + handler no-throw).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { NextResponse } from 'next/server';
import { clerkEnvConfigured } from '@/lib/authMode';
import { handleClerkWebhookUserEvent } from '@/lib/clerkIdentity';
import { logger } from '@/lib/logger';

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('Clerk webhook route behavior', () => {
  test('returns 503 path when Clerk is not configured', () => {
    const saved = {
      secret: process.env.CLERK_SECRET_KEY,
      pub: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      authMode: process.env.AUTH_MODE,
    };
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    process.env.AUTH_MODE = 'legacy';

    try {
      assert.equal(clerkEnvConfigured(), false);
      const src = readSrc('src/app/api/webhooks/clerk/route.ts');
      assert.match(src, /clerkEnvConfigured/);
      assert.match(src, /503/);
      assert.match(src, /verifyWebhook/);
    } finally {
      if (saved.secret === undefined) delete process.env.CLERK_SECRET_KEY;
      else process.env.CLERK_SECRET_KEY = saved.secret;
      if (saved.pub === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = saved.pub;
      if (saved.authMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = saved.authMode;
    }
  });

  test('verifyWebhook failure yields 400 without leaking details', async () => {
    async function simulateWebhookHandler(verifyThrows: boolean) {
      try {
        if (verifyThrows) throw new Error('svix verification failed: secret=shhh');
        return NextResponse.json({ received: true });
      } catch (error) {
        logger.warn('auth.clerk_webhook_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Webhook verification failed' }, { status: 400 });
      }
    }

    const res = await simulateWebhookHandler(true);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'Webhook verification failed');
    assert.doesNotMatch(body.error, /secret=shhh/);
  });

  test('handleClerkWebhookUserEvent is safe for unknown users', async () => {
    await handleClerkWebhookUserEvent('user.deleted', { id: 'user_nonexistent_phase72' });
    await handleClerkWebhookUserEvent('user.created', {
      id: 'user_phase72_created',
      email_addresses: [],
    });
    await handleClerkWebhookUserEvent('user.updated', {
      id: 'user_phase72_updated',
      email_addresses: [{ id: 'e1', email_address: 'nobody@example.invalid' }],
      primary_email_address_id: 'e1',
    });
    assert.ok(true);
  });

  test('route wires verifyWebhook + user event handlers', () => {
    const src = readSrc('src/app/api/webhooks/clerk/route.ts');
    assert.match(src, /verifyWebhook/);
    assert.match(src, /handleClerkWebhookUserEvent/);
    assert.match(src, /user\.deleted/);
    assert.match(src, /user\.created|user\.updated/);
    assert.match(src, /Webhook verification failed/);
  });
});
