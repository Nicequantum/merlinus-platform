import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auditMetadataHasPathname } from '@/lib/imageAccess';

describe('image upload audit metadata', () => {
  it('matches exact pathname in audit metadata JSON', () => {
    const pathname = 'benz-tech/1740000000000-ro-page.jpg';
    const metadata = JSON.stringify({ pathname, size: 2048 });
    assert.equal(auditMetadataHasPathname(metadata, pathname), true);
    assert.equal(auditMetadataHasPathname(metadata, 'benz-tech/other.jpg'), false);
  });
});