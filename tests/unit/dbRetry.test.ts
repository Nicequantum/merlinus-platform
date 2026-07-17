import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import {
  computeDbRetryDelayMs,
  DB_HEALTH_RETRY_BASE_MS,
  DB_HEALTH_RETRY_MAX_MS,
  isRetryableDbConnectionError,
  withDbConnectionRetry,
} from '@/lib/dbRetry';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('database connection retry', () => {
  it('detects retryable Prisma connection errors', () => {
    const error = new Prisma.PrismaClientKnownRequestError('timeout', {
      code: 'P1001',
      clientVersion: 'test',
    });
    assert.equal(isRetryableDbConnectionError(error), true);
    assert.equal(
      isRetryableDbConnectionError(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        })
      ),
      false
    );
  });

  it('uses exponential backoff capped by max delay', () => {
    assert.equal(computeDbRetryDelayMs(0), DB_HEALTH_RETRY_BASE_MS);
    assert.equal(computeDbRetryDelayMs(1), DB_HEALTH_RETRY_BASE_MS * 2);
    assert.equal(computeDbRetryDelayMs(10), DB_HEALTH_RETRY_MAX_MS);
  });

  it('retries transient connection failures then succeeds', async () => {
    let attempts = 0;
    const result = await withDbConnectionRetry(
      async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
            code: 'P1001',
            clientVersion: 'test',
          });
        }
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 4, context: 'test.retry' }
    );

    assert.equal(result, 'ok');
    assert.equal(attempts, 2);
  });

  it('does not retry non-connection Prisma errors', async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withDbConnectionRetry(
          async () => {
            attempts += 1;
            throw new Prisma.PrismaClientKnownRequestError('unique', {
              code: 'P2002',
              clientVersion: 'test',
            });
          },
          { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 4 }
        ),
      Prisma.PrismaClientKnownRequestError
    );
    assert.equal(attempts, 1);
  });

  it('keeps login and RO extract off the retry wrapper', () => {
    const auth = readSrc('src/lib/auth.ts');
    const extract = readSrc('src/app/api/repair-orders/extract/route.ts');
    const login = readSrc('src/app/api/auth/login/route.ts');
    assert.equal(auth.includes('withDbConnectionRetry'), false);
    assert.equal(extract.includes('withDbConnectionRetry'), false);
    assert.equal(login.includes('withDbConnectionRetry'), false);
    assert.ok(readSrc('src/lib/healthChecks.ts').includes('probeDatabaseConnection'));
  });
});