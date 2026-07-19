import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isNetworkFailure,
  isRetriableHttpStatus,
  networkRetryDelayMs,
  NETWORK_RETRY_BASE_MS,
  NETWORK_RETRY_MAX_ATTEMPTS,
  parseRetryAfterMs,
} from '../../src/lib/networkErrors';

describe('networkErrors', () => {
  test('isNetworkFailure detects fetch transport errors', () => {
    assert.equal(isNetworkFailure(new TypeError('Failed to fetch')), true);
    assert.equal(isNetworkFailure(new Error('NetworkError when attempting to fetch resource.')), true);
  });

  test('isNetworkFailure ignores abort and API errors', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    assert.equal(isNetworkFailure(abort), false);
    assert.equal(isNetworkFailure(new Error('Request failed. Please try again.')), false);
  });

  test('retry backoff grows exponentially', () => {
    assert.equal(networkRetryDelayMs(0, { jitter: false }), NETWORK_RETRY_BASE_MS);
    assert.equal(networkRetryDelayMs(1, { jitter: false }), NETWORK_RETRY_BASE_MS * 2);
    assert.equal(NETWORK_RETRY_MAX_ATTEMPTS, 3);
    // With jitter, stay within [base, base * 1.25]
    const withJitter = networkRetryDelayMs(0);
    assert.ok(withJitter >= NETWORK_RETRY_BASE_MS);
    assert.ok(withJitter <= NETWORK_RETRY_BASE_MS * 1.25 + 1);
  });

  test('isRetriableHttpStatus covers transient upload failures', () => {
    assert.equal(isRetriableHttpStatus(429), true);
    assert.equal(isRetriableHttpStatus(503), true);
    assert.equal(isRetriableHttpStatus(401), false);
    // Bare 500 only when includeServerError (Workers cold-start path)
    assert.equal(isRetriableHttpStatus(500), false);
    assert.equal(isRetriableHttpStatus(500, { includeServerError: true }), true);
  });

  test('parseRetryAfterMs reads seconds and dates', () => {
    assert.equal(parseRetryAfterMs('2'), 2000);
    const future = new Date(Date.now() + 5000).toUTCString();
    const delay = parseRetryAfterMs(future);
    assert.ok(delay !== undefined && delay >= 4000 && delay <= 6000);
  });
});