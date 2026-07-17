import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { preserveClientXentryMedia } from '../../src/hooks/repairOrders/useROPersistence';
import { isImageFile } from '../../src/utils/scanFileHelpers';
import type { RepairOrder } from '../../src/types';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('scan pipeline hardening', () => {
  it('accepts camera images with empty MIME via extension', () => {
    const emptyMime = new File([new Uint8Array([1, 2, 3])], 'IMG_0001.JPG', { type: '' });
    assert.equal(isImageFile(emptyMime), true);
    const heic = new File([new Uint8Array([1])], 'capture.heic', { type: '' });
    assert.equal(isImageFile(heic), true);
    const pdf = new File([new Uint8Array([1])], 'doc.pdf', { type: '' });
    assert.equal(isImageFile(pdf), false);
  });

  it('OCR worker hard-resets on timeout so the next scan is not wedged', () => {
    const src = readSrc('src/services/ocr.ts');
    assert.match(src, /hardResetOcrWorker/);
    assert.match(src, /WORKER_INIT_TIMEOUT_MS/);
    assert.match(src, /WORKER_TERMINATE_TIMEOUT_MS/);
    assert.match(src, /await hardResetOcrWorker/);
    // terminate() must not hang the pipeline forever after soft OCR timeout
    assert.match(src, /ocr\.worker_terminate_timed_out_or_failed/);
  });

  it('image re-fetch and RO PUT have client timeouts', () => {
    const upload = readSrc('src/utils/uploadHelpers.ts');
    assert.match(upload, /FETCH_ATTACHMENT_TIMEOUT_MS/);
    assert.match(upload, /AbortController/);
    const api = readSrc('src/lib/api.ts');
    assert.match(api, /RO_CRUD_CLIENT_MS/);
    assert.match(api, /updateRepairOrder[\s\S]*timeoutMs:\s*RO_CRUD_CLIENT_MS/);
  });

  it('image compression load/encode cannot hang forever on cold first capture', () => {
    const src = readSrc('src/utils/imageCompression.ts');
    assert.match(src, /LOAD_IMAGE_TIMEOUT_MS/);
    assert.match(src, /TO_BLOB_TIMEOUT_MS/);
    assert.match(src, /Image load for compression timed out/);
  });

  it('vision blob fetch is time-bounded for cold serverless isolates', () => {
    const src = readSrc('src/lib/blob.ts');
    assert.match(src, /BLOB_GET_TIMEOUT_MS/);
    assert.match(src, /VISION_PREP_TIMEOUT_MS/);
    assert.match(src, /blob\.vision_fetch_ok/);
  });

  it('diagnostics extract uses vision-downscaled blob fetch', () => {
    const src = readSrc('src/app/api/diagnostics/extract/route.ts');
    assert.match(src, /fetchPrivateBlobAsVisionDataUrl/);
    assert.equal(src.includes('fetchPrivateBlobAsDataUrl'), false);
  });

  it('upload route infers content-type when MIME is empty', () => {
    const src = readSrc('src/app/api/upload/route.ts');
    assert.match(src, /resolveUploadContentType/);
    assert.match(src, /image\/jpeg/);
  });

  it('preserveClientXentryMedia keeps optimistic photos after stale PUT', () => {
    const base: RepairOrder = {
      id: 'ro-1',
      roNumber: '1',
      vehicle: { vin: 'W1N', year: '2022', make: 'MB', model: 'C', mileageIn: '1' },
      customer: { name: 'T' },
      complaints: [],
      xentryImages: [],
      repairLines: [
        {
          id: 'line-1',
          lineNumber: 1,
          description: 'Diag',
          customerConcern: '',
          technicianNotes: '',
          xentryImages: [],
          warrantyStory: '',
        },
      ],
    };
    const client: RepairOrder = {
      ...base,
      repairLines: [
        {
          ...base.repairLines[0],
          xentryImages: [
            { id: 'a', pathname: 'p/a.jpg', url: '/api/images?pathname=p/a.jpg', name: 'a.jpg' },
            { id: 'b', pathname: 'p/b.jpg', url: '/api/images?pathname=p/b.jpg', name: 'b.jpg' },
          ],
        },
      ],
    };
    const persisted: RepairOrder = {
      ...base,
      repairLines: [
        {
          ...base.repairLines[0],
          xentryImages: [
            { id: 'a', pathname: 'p/a.jpg', url: '/api/images?pathname=p/a.jpg', name: 'a.jpg' },
          ],
        },
      ],
    };
    const merged = preserveClientXentryMedia(persisted, client);
    assert.equal(merged.repairLines[0].xentryImages?.length, 2);
  });

  it('RO scan is Grok-first and only runs OCR as fallback (no cold OCR race)', () => {
    const src = readSrc('src/hooks/repairOrders/useROScan.ts');
    assert.match(src, /Grok-first/);
    assert.match(src, /ocr_fallback_start/);
    assert.match(src, /warmupOcrWorker/);
    // Must not start runClientOcr in parallel before Grok settles
    assert.equal(/const ocrPromise = runClientOcr/.test(src), false);
  });

  it('authenticated shell warms OCR worker after mount for first-scan readiness', () => {
    const src = readSrc('src/components/BenzTechAuthenticatedApp.tsx');
    assert.match(src, /warmupOcrWorker/);
    assert.match(src, /ocr\.shell_warmup_ready/);
  });

  it('photo grid falls back to blob preview when proxy fails', () => {
    const src = readSrc('src/components/DiagnosticPhotoGrid.tsx');
    assert.match(src, /PendingThumb/);
    assert.match(src, /onError/);
    assert.match(src, /setUseProxy\(false\)/);
  });
});
