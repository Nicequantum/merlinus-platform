import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { handleRouteError, reportMappedRouteError, shouldCaptureRouteError } from '@/lib/errors';
import { publicSafeMessage, redactForLog, redactString } from '@/lib/logRedact';
import {
  createRequestId,
  getRequestId,
  REQUEST_ID_HEADER,
  runWithRequestContext,
} from '@/lib/requestContext';
import { mapBlobRouteError, mapGrokRouteError } from '@/lib/scanRouteErrors';

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('Phase 7.2 observability (H8–H11)', () => {
  test('H8 — redacts secrets, tokens, connection strings, env names', () => {
    const raw =
      'Bearer supersecret token xai-abc123def vercel_blob_rw_xyz ' +
      'postgresql://user:pass@host/db SESSION_SECRET=abc GROK_API_KEY=x';
    const redacted = redactString(raw);
    assert.ok(!redacted.includes('supersecret'));
    assert.ok(!redacted.includes('xai-abc123def'));
    assert.ok(!redacted.includes('vercel_blob_rw_xyz'));
    assert.ok(!redacted.includes('pass@'));
    assert.ok(!redacted.includes('SESSION_SECRET'));
    assert.ok(!redacted.includes('GROK_API_KEY'));

    const ctx = redactForLog({
      password: 'hunter2',
      token: 'tok',
      safe: 'ok',
      nested: { DATA_ENCRYPTION_KEY: 'deadbeef' },
    });
    assert.equal(ctx?.password, '[Redacted]');
    assert.equal(ctx?.token, '[Redacted]');
    assert.equal(ctx?.safe, 'ok');
  });

  test('H8 — publicSafeMessage strips env names', () => {
    assert.match(publicSafeMessage('missing BLOB_READ_WRITE_TOKEN'), /photo storage credentials/i);
    assert.doesNotMatch(publicSafeMessage('missing GROK_API_KEY'), /GROK_API_KEY/);
  });

  test('H8 — blob/grok public messages avoid env var names', () => {
    const blob = mapBlobRouteError(new Error('BLOB_READ_WRITE_TOKEN missing'), 'upload');
    assert.doesNotMatch(blob.message, /BLOB_READ_WRITE_TOKEN/);
    assert.match(blob.logDetail, /BLOB|token|missing/i);

    const grok = mapGrokRouteError(new Error('GROK_API_KEY not configured'), 'Story generation');
    assert.doesNotMatch(grok.message, /GROK_API_KEY/);
    assert.equal(grok.status, 503);
  });

  test('H9 — only 5xx should capture to Sentry', () => {
    assert.equal(shouldCaptureRouteError(400), false);
    assert.equal(shouldCaptureRouteError(404), false);
    assert.equal(shouldCaptureRouteError(429), false);
    assert.equal(shouldCaptureRouteError(500), true);
    assert.equal(shouldCaptureRouteError(503), true);

    const src = readSrc('src/lib/errors.ts');
    assert.match(src, /shouldCaptureRouteError/);
    assert.match(src, /status >= 500/);
  });

  test('H10 — request correlation id is stable in ALS context', async () => {
    const id = createRequestId('client-req-12345');
    assert.equal(id, 'client-req-12345');

    await runWithRequestContext({ requestId: 'corr-abc-001', routeKey: 'test' }, async () => {
      assert.equal(getRequestId(), 'corr-abc-001');
    });
    assert.equal(getRequestId(), undefined);

    const res = handleRouteError(new Error('Unauthorized'), 'auth.test');
    // outside ALS — may omit requestId
    assert.equal(res.status, 401);
  });

  test('H10 — apiRoute wires request context and header', () => {
    const src = readSrc('src/lib/apiRoute.ts');
    assert.match(src, /runWithRequestContext/);
    assert.match(src, /applyRequestIdHeader/);
    assert.match(src, /resolveRequestIdFromRequest/);
  });

  test('H10 — rate limit success path is debug; denials warn', () => {
    const src = readSrc('src/lib/rate-limit.ts');
    assert.match(src, /logger\.debug\('rate_limit\.check'/);
    assert.match(src, /rate_limit\.denied/);
    assert.match(src, /resetMemoryRateLimitStoreForTests/);
  });

  test('H11 — reportMappedRouteError + AI routes use it', async () => {
    const mapped = mapGrokRouteError(new Error('Grok API error: 503 — down'), 'Story generation');
    const res = reportMappedRouteError(mapped, new Error('Grok API error: 503 — down'), 'story.generate');
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string; requestId?: string };
    assert.ok(body.error.length > 0);

    for (const path of [
      'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts',
      'src/app/api/repair-orders/[id]/lines/[lineId]/score-story/route.ts',
      'src/app/api/repair-orders/[id]/lines/[lineId]/review-story/route.ts',
      'src/app/api/repair-orders/extract/route.ts',
      'src/app/api/diagnostics/extract/route.ts',
      'src/app/api/upload/route.ts',
    ]) {
      assert.match(readSrc(path), /reportMappedRouteError/, path);
    }
  });

  test('H8 — Sentry init scrubs and client uses beforeSend', () => {
    const scrub = readSrc('src/lib/sentryScrub.ts');
    assert.match(scrub, /scrubSentryEventInPlace|scrubSentryEvent/);
    assert.match(scrub, /redactForLog/);
    assert.match(scrub, /Authorization|cookie/i);
    // Client-safe module must not pull Node builtins (Vercel client bundle).
    assert.doesNotMatch(scrub, /node:crypto|node:async_hooks|requestContext/);
    const server = readSrc('src/lib/sentryInit.ts');
    assert.match(server, /beforeSend\s*\(/);
    assert.match(server, /getRequestId|requestId/);
    const client = readSrc('src/instrumentation-client.ts');
    // Method form (not property shorthand) so scrub runs and event is returned.
    assert.match(client, /beforeSend\s*\(/);
    assert.match(client, /scrubSentryEventForClient/);
    assert.match(client, /@\/lib\/sentryScrub/);
    assert.doesNotMatch(client, /from ['"]@\/lib\/sentryInit['"]/);
  });

  test('logger redacts and attaches requestId field', () => {
    const src = readSrc('src/lib/logger.ts');
    assert.match(src, /redactForLog/);
    assert.match(src, /getRequestId/);
    assert.match(src, /requestId/);
  });

  test('REQUEST_ID_HEADER constant', () => {
    assert.equal(REQUEST_ID_HEADER, 'x-request-id');
  });
});
