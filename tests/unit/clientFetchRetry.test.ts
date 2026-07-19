import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('clientFetchRetry + owner cold-start hardening', () => {
  it('exports fetch retry helpers with 500 retry for GET and optional POST', () => {
    const src = readSrc('src/lib/clientFetchRetry.ts');
    assert.match(src, /export async function fetchWithClientRetry/);
    assert.match(src, /export async function fetchJsonWithClientRetry/);
    assert.match(src, /export async function warmOwnerIsolate/);
    assert.match(src, /retryPostServerError/);
    assert.match(src, /includeServerError/);
    assert.match(src, /\/api\/owner\/warmup/);
  });

  it('owner national shell warms isolate, prefetches rooftops, and keep-alives', () => {
    const shell = readSrc('src/components/apex/ApexOwnerNationalShell.tsx');
    assert.match(shell, /warmOwnerIsolate/);
    assert.match(shell, /prefetchOwnerDealerships/);
    assert.match(shell, /keepAlivePublicStatus/);
    assert.match(shell, /OWNER_ISOLATE_KEEPALIVE_MS/);
    assert.match(shell, /visibilitychange/);
  });

  it('owner login session clients use retrying fetch for list and enter paths', () => {
    const login = readSrc('src/lib/apexLoginSession.ts');
    assert.match(login, /fetchJsonWithClientRetry/);
    assert.match(login, /retryPostServerError:\s*true/);
    assert.match(login, /enterOwnerDealership/);
    assert.match(login, /fetchOwnerDealerships/);
    assert.match(login, /warmOwnerIsolate/);

    const summary = readSrc('src/lib/ownerSummaryClient.ts');
    assert.match(summary, /fetchJsonWithClientRetry/);
    assert.match(summary, /\/api\/owner\/summary/);
  });

  it('warmup route is lightweight owner auth + SELECT 1', () => {
    const route = readSrc('src/app/api/owner/warmup/route.ts');
    assert.match(route, /requireOwner:\s*true/);
    assert.match(route, /skipRateLimit:\s*true/);
    assert.match(route, /useRls:\s*false/);
    assert.match(route, /\$queryRaw`SELECT 1`/);
  });

  it('api list path retries bare 500 on GET', () => {
    const api = readSrc('src/lib/api.ts');
    assert.match(api, /shouldRetryServerErrorForMethod/);
    assert.match(api, /includeServerError/);
  });

  it('RO list auto-retries transient failures before problem-loading UI', () => {
    const list = readSrc('src/hooks/repairOrders/useROList.ts');
    assert.match(list, /NETWORK_RETRY_MAX_ATTEMPTS/);
    assert.match(list, /networkRetryDelayMs/);
    assert.match(list, /status === 500/);
  });
});
