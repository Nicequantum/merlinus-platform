import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());

describe('upload helpers', () => {
  it('retries uploads and uploads files with bounded concurrency', () => {
    const src = readFileSync(resolve(root, 'src/utils/uploadHelpers.ts'), 'utf8');
    assert.ok(src.includes('UPLOAD_CONCURRENCY'));
    assert.ok(src.includes('UPLOAD_PER_FILE_ATTEMPTS'));
    assert.ok(src.includes('isRetriableUploadError'));
    assert.ok(src.includes('mapWithConcurrency'));
    assert.ok(src.includes('api.uploadImage'));
    assert.ok(src.includes('ensureUploadPathReady'));
    assert.ok(src.includes('withUploadSlot'));
    assert.ok(src.includes('UPLOAD_HARD_TIMEOUT_MS'));
  });

  it('bay upload readiness gate serializes cold-start puts', () => {
    const src = readFileSync(resolve(root, 'src/lib/bayUploadReady.ts'), 'utf8');
    assert.ok(src.includes('ensureUploadPathReady'));
    assert.ok(src.includes('withUploadSlot'));
    assert.ok(src.includes('UPLOAD_SLOT_CONCURRENCY'));
    assert.ok(src.includes('markUploadPathReady'));
  });
});
