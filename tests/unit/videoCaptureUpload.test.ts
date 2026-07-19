import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  VIDEO_UPLOAD_CHUNK_BYTES,
  VIDEO_UPLOAD_MAX_CHUNKS,
  computeChunkCount,
} from '../../src/lib/videoInspection/uploadConstants';
import {
  ensurePathnamesArray,
  parseReceivedMask,
  parseUploadMeta,
} from '../../src/lib/videoInspection/uploadSession';

describe('PR-M1b video capture / chunked upload', () => {
  test('computeChunkCount covers full file with 2MiB parts', () => {
    assert.equal(computeChunkCount(0), 0);
    assert.equal(computeChunkCount(1), 1);
    assert.equal(computeChunkCount(VIDEO_UPLOAD_CHUNK_BYTES), 1);
    assert.equal(computeChunkCount(VIDEO_UPLOAD_CHUNK_BYTES + 1), 2);
    assert.ok(computeChunkCount(100 * 1024 * 1024) <= VIDEO_UPLOAD_MAX_CHUNKS);
  });

  test('received mask and pathnames helpers', () => {
    assert.deepEqual(parseReceivedMask('[0,2,1]'), [0, 2, 1]);
    assert.deepEqual(parseReceivedMask('bad'), []);
    assert.deepEqual(ensurePathnamesArray(3, ['a']), ['a', '', '']);
    assert.deepEqual(parseUploadMeta('{"title":"X"}').title, 'X');
  });

  test('schema and migration define VideoUploadSession with RLS', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    assert.ok(schema.includes('model VideoUploadSession'));
    assert.ok(schema.includes('chunkPathnames'));
    assert.ok(schema.includes('receivedMask'));

    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/20250723120000_video_upload_sessions/migration.sql'),
      'utf8'
    );
    assert.ok(sql.includes('VideoUploadSession'));
    assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
    assert.ok(sql.includes('FORCE ROW LEVEL SECURITY'));
    assert.ok(!sql.includes('ALTER TABLE "RepairOrder"'));
    assert.ok(!sql.includes('ALTER TABLE "RepairLine"'));
  });

  test('chunked upload routes require video_mpi module', () => {
    for (const file of [
      'src/app/api/video-inspections/upload/init/route.ts',
      'src/app/api/video-inspections/upload/chunk/route.ts',
      'src/app/api/video-inspections/upload/complete/route.ts',
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.ok(src.includes("requireModule: 'video_mpi'"), file);
    }
  });

  test('capture and offline queue modules exist (client helpers)', () => {
    const capture = readFileSync(
      resolve(process.cwd(), 'src/lib/videoInspection/captureSession.ts'),
      'utf8'
    );
    assert.ok(capture.includes('wakeLock'));
    assert.ok(capture.includes('orientation'));
    assert.ok(capture.includes('requestFullscreen') || capture.includes('enterImmersive'));
    assert.ok(capture.includes('beforeunload'));
    assert.ok(capture.includes('pagehide'));
    assert.ok(capture.includes('stopAllTracks') || capture.includes('getTracks'));
    assert.ok(capture.includes('forceReleaseHardware') || capture.includes('async release'));
    assert.ok(capture.includes('cssImmersive') || capture.includes('onImmersiveChange'));
    // Regression: never *call* iOS video.webkitEnterFullscreen (empty MediaRecorder blobs)
    assert.ok(!capture.includes('webkitEnterFullscreen?.('));
    assert.ok(!capture.includes('video.webkitEnterFullscreen()'));
    // Late dataavailable grace period after onstop
    assert.ok(capture.includes('assembleWithGrace') || capture.includes('triesLeft'));
    assert.ok(capture.includes('normalizeVideoMime') || capture.includes('formatRecordingTimer'));
    assert.ok(capture.includes('onElapsed'));

    const queue = readFileSync(
      resolve(process.cwd(), 'src/lib/videoInspection/offlineQueue.ts'),
      'utf8'
    );
    assert.ok(queue.includes('indexedDB'));
    assert.ok(queue.includes('enqueuePendingUpload'));
    assert.ok(queue.includes('repairOrderId'));

    const client = readFileSync(
      resolve(process.cwd(), 'src/lib/videoInspection/chunkedUploadClient.ts'),
      'utf8'
    );
    assert.ok(client.includes('upload/init'));
    assert.ok(client.includes('upload/chunk'));
    assert.ok(client.includes('upload/complete'));
    assert.ok(client.includes('repairOrderId'));
    assert.ok(client.includes('normalizeContentType'));
  });

  test('upload routes accept repairOrderId and normalize content types', () => {
    const upload = readFileSync(
      resolve(process.cwd(), 'src/app/api/video-inspections/upload/route.ts'),
      'utf8'
    );
    assert.ok(upload.includes('resolveRepairOrderLink'));
    assert.ok(upload.includes('repairOrderId'));
    assert.ok(upload.includes('split'));

    const complete = readFileSync(
      resolve(process.cwd(), 'src/app/api/video-inspections/upload/complete/route.ts'),
      'utf8'
    );
    assert.ok(complete.includes('resolveRepairOrderLink'));

    const list = readFileSync(resolve(process.cwd(), 'src/app/api/video-inspections/route.ts'), 'utf8');
    assert.ok(list.includes('repairOrderId'));
  });

  test('videoBlob supports chunk pathnames', () => {
    const blob = readFileSync(resolve(process.cwd(), 'src/lib/videoBlob.ts'), 'utf8');
    assert.ok(blob.includes('isAllowedVideoChunkPathname'));
    assert.ok(blob.includes('uploadVideoChunkToBlob'));
    assert.ok(blob.includes('benz-tech/video-chunk/'));
  });
});
