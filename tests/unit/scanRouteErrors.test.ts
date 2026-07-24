import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapBlobRouteError,
  mapGrokRouteError,
  mapScanRouteError,
  parseGrokApiErrorBody,
  ScanRouteError,
} from '@/lib/scanRouteErrors';
import { handleRouteError } from '@/lib/errors';

describe('scan route errors', () => {
  it('surfaces blob token misconfiguration', () => {
    // R2 binding missing (production path) + legacy Blob token string both map to 503
    const r2 = mapBlobRouteError(
      new Error('Cloudflare R2 binding APEX_R2 is not available. Check wrangler.toml'),
      'upload'
    );
    assert.equal(r2.status, 503);
    assert.match(r2.message, /Photo storage is not configured/i);
    assert.doesNotMatch(r2.message, /APEX_R2/);
    assert.match(r2.logDetail, /APEX_R2/);

    const legacy = mapBlobRouteError(new Error('BLOB_READ_WRITE_TOKEN is not configured'), 'upload');
    assert.equal(legacy.status, 503);
    assert.match(legacy.message, /Photo storage is not configured/i);
    assert.doesNotMatch(legacy.message, /BLOB_READ_WRITE_TOKEN/);
    assert.match(legacy.logDetail, /BLOB_READ_WRITE_TOKEN/);
  });

  it('maps bad xAI API keys to bay-safe 503 without console.x.ai copy', () => {
    const mapped401 = mapGrokRouteError(
      new Error('Grok API error: 401 — Invalid API key provided'),
      'Repair order scan'
    );
    assert.equal(mapped401.status, 503);
    assert.match(mapped401.message, /API key rejected|misconfigured/i);
    assert.doesNotMatch(mapped401.message, /console\.x\.ai/i);

    // xAI often returns HTTP 400 for incorrect keys (live RO scan symptom).
    const mapped400 = mapGrokRouteError(
      new Error(
        'Grok API error: 400 — Incorrect API key provided. You can obtain an API key from https://console.x.ai.'
      ),
      'Repair order scan'
    );
    assert.equal(mapped400.status, 503);
    assert.match(mapped400.message, /API key rejected|misconfigured/i);
    assert.doesNotMatch(mapped400.message, /console\.x\.ai/i);
    assert.match(mapped400.logDetail, /Incorrect API key/i);
  });

  it('parses xAI JSON error bodies', () => {
    const detail = parseGrokApiErrorBody(
      JSON.stringify({ error: { message: 'Incorrect API key', code: 'invalid_api_key' } })
    );
    assert.match(detail, /Incorrect API key/);
    assert.match(detail, /invalid_api_key/);
  });

  it('handleRouteError returns real message for upload route context', async () => {
    const response = handleRouteError(
      new Error('BLOB_READ_WRITE_TOKEN is not configured'),
      'upload'
    );
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /Photo storage is not configured/i);
    assert.doesNotMatch(body.error, /BLOB_READ_WRITE_TOKEN/);
    assert.doesNotMatch(body.error, /Something went wrong/);
  });

  it('handleRouteError returns ScanRouteError message for extract context', async () => {
    const response = handleRouteError(
      new ScanRouteError('Repair order scan failed (HTTP 502). — model not found', 502),
      'ro.extract'
    );
    assert.equal(response.status, 502);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /model not found/);
  });

  it('mapScanRouteError classifies Grok failures in diagnostics context', () => {
    const mapped = mapScanRouteError(new Error('Grok API error: 429 — rate limit'), 'diagnostics.extract');
    assert.equal(mapped.status, 429);
    assert.match(mapped.message, /Diagnostic scan|AI service is busy/i);
  });
});