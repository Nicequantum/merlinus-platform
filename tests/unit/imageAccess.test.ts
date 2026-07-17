import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { extractPathnameFromImageRef } from '../../src/lib/imageUrls';

/** Mirrors pathnamesFromImageJson in imageAccess.ts for unit testing without DB. */
function pathnamesFromImageJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (typeof item === 'string') {
          return extractPathnameFromImageRef(item);
        }
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          if (typeof record.pathname === 'string') {
            return record.pathname;
          }
          if (typeof record.url === 'string') {
            return extractPathnameFromImageRef(record.url);
          }
        }
        return null;
      })
      .filter((pathname): pathname is string => Boolean(pathname));
  } catch {
    return [];
  }
}

describe('image pathname matching', () => {
  test('matches exact pathname only, not substrings', () => {
    const json = JSON.stringify([
      { id: 'a', pathname: 'benz-tech/dealer/photo-abc', name: 'a.jpg' },
    ]);
    const pathnames = pathnamesFromImageJson(json);

    assert.ok(pathnames.includes('benz-tech/dealer/photo-abc'));
    // Substring DB contains would false-positive on benz-tech/dealer/photo-abc-extra
    assert.equal(pathnames.includes('benz-tech/dealer/photo-abc-extra'), false);
  });

  test('parses legacy string entries and proxy urls', () => {
    const json = JSON.stringify([
      'benz-tech/dealer/legacy.jpg',
      '/api/images?pathname=benz-tech%2Fdealer%2Fproxy.jpg',
    ]);
    const pathnames = pathnamesFromImageJson(json);

    assert.deepEqual(pathnames, ['benz-tech/dealer/legacy.jpg', 'benz-tech/dealer/proxy.jpg']);
  });
});