import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { handleRouteError } from '@/lib/errors';
import { mapRouteError } from '@/lib/routeErrorMapper';

describe('unified route error mapping', () => {
  it('maps database connection failures to actionable 503 messages', async () => {
    const mapped = mapRouteError(new Error("Can't reach database server at db:5432"), 'ros.update');
    assert.equal(mapped.status, 503);
    assert.match(mapped.message, /Database is temporarily unavailable/i);

    const response = handleRouteError(new Error('database connection refused'), 'ros.update');
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /Database is temporarily unavailable/i);
    assert.doesNotMatch(body.error, /Something went wrong/);
  });

  it('maps audit write failures to compliance-safe 503 messages', () => {
    const mapped = mapRouteError(
      new Error('Critical audit log write failed for action "story.edit"'),
      'ros.update'
    );
    assert.equal(mapped.status, 503);
    assert.match(mapped.message, /compliance audit record failed/i);
  });

  it('maps Prisma unique constraint violations to 409', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const mapped = mapRouteError(prismaError, 'users.create');
    assert.equal(mapped.status, 409);
    assert.match(mapped.message, /already exists/i);
  });

  it('maps story.generate Grok failures with story-specific label', () => {
    const mapped = mapRouteError(new Error('Grok API error: 429 — rate limit'), 'story.generate');
    assert.equal(mapped.status, 429);
    assert.match(mapped.message, /Story generation|AI service is busy/i);
  });

  it('keeps scan route specialized messaging', () => {
    const mapped = mapRouteError(
      new Error('BLOB_READ_WRITE_TOKEN is not configured'),
      'upload'
    );
    assert.equal(mapped.status, 503);
    assert.match(mapped.message, /Photo storage is not configured/i);
    assert.doesNotMatch(mapped.message, /BLOB_READ_WRITE_TOKEN/);
  });
});