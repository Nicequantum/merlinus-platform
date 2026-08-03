import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('Owner onboard CSRF', () => {
  it('provision POST sends double-submit CSRF header', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/apex/OwnerOnboardDealershipForm.tsx'),
      'utf8'
    );
    assert.match(src, /withCsrfHeaders/);
    assert.match(src, /readCsrfTokenFromDocument/);
    assert.match(src, /\/api\/owner\/provision-dealer/);
    assert.doesNotMatch(
      src,
      /fetch\('\/api\/owner\/provision-dealer',\s*\{[^}]*headers:\s*\{\s*'Content-Type'/s
    );
  });
});
