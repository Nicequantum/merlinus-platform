import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Regression: static sharp import via @/lib/blob crashed Cloudflare Workers
 * routes (/api/upload, /api/images) into HTML 500 before JSON auth errors.
 */
describe('blob / vision sharp isolation (Workers)', () => {
  it('blob.ts does not statically import sharp or visionImagePrep', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/blob.ts'), 'utf8');
    assert.doesNotMatch(src, /import\s+.*from\s+['"]sharp['"]/);
    assert.doesNotMatch(src, /import\s+\{[^}]*bufferToVisionDataUrl[^}]*\}\s+from\s+['"]\.\/visionImagePrep['"]/);
    // Vision prep may be loaded only inside fetchPrivateBlobAsVisionDataUrl
    assert.match(src, /import\(['"]\.\/visionImagePrep['"]\)/);
  });

  it('visionImagePrep does not statically import sharp', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/visionImagePrep.ts'), 'utf8');
    assert.doesNotMatch(src, /^import\s+.*from\s+['"]sharp['"]/m);
    assert.match(src, /import\(['"]sharp['"]\)/);
  });

  it('upload route uses blob upload helper without vision prep', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/api/upload/route.ts'), 'utf8');
    assert.match(src, /uploadImageToBlob/);
    assert.doesNotMatch(src, /visionImagePrep|fetchPrivateBlobAsVisionDataUrl|from\s+['"]sharp['"]/);
  });
});
