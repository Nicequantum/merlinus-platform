import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Apex platform UI foundation (Phase 5.6)', () => {
  it('defines scoped apex design tokens', () => {
    const css = readSrc('src/styles/apex-platform.css');
    assert.match(css, /\[data-platform='apex'\]/);
    assert.match(css, /--apex-cyan/);
    assert.match(css, /--apex-silver/);
    assert.match(css, /\.apex-login-shell/);
  });

  it('ApexLogoMark renders metallic A with circuit and gauge elements', () => {
    const src = readSrc('src/components/apex/ApexLogoMark.tsx');
    assert.match(src, /apex-silver/);
    assert.match(src, /apex-cyan/);
    assert.match(src, /Gauge arc/i);
    assert.match(src, /Circuit traces/i);
    assert.match(src, /feGaussianBlur/);
  });

  it('ApexLoginShell uses unified identifier field', () => {
    const src = readSrc('src/components/apex/ApexLoginShell.tsx');
    assert.match(src, /Email, D7, or Username/);
    assert.match(src, /data-platform="apex"/);
    assert.match(src, /onSelectDealership/);
  });

  it('ApexPlatformApp routes owner national scope separately', () => {
    const src = readSrc('src/components/apex/ApexPlatformApp.tsx');
    assert.match(src, /ApexOwnerNationalShell/);
    // PR-G2: owner home includes platform national and DealerGroup scope
    assert.match(src, /isOwnerHomeScope|isOwnerNationalScope/);
    assert.match(src, /loginWithIdentifier/);
    assert.match(src, /BenzTechAuthenticatedApp/);
    // Must trust login body immediately and never hang on /api/auth/me
    assert.match(src, /applySession\(result\.session\)/);
    assert.match(src, /clearOnMissing:\s*false/);
    assert.match(src, /timeoutMs:\s*8_000|timeoutMs:\s*8000/);
  });

  it('HomePageClient keeps Merlinus path when platformMode is not apex', () => {
    const src = readSrc('src/components/HomePageClient.tsx');
    assert.match(src, /platformMode === 'apex'/);
    assert.match(src, /ApexPlatformApp/);
    assert.match(src, /BenzTechApp/);
  });

  it('server page passes platformMode from getPlatformMode', () => {
    const src = readSrc('src/app/page.tsx');
    assert.match(src, /getPlatformMode/);
    assert.match(src, /platformMode=/);
  });

  it('apex login session sends identifier to unified login API', () => {
    const src = readSrc('src/lib/apexLoginSession.ts');
    assert.match(src, /identifier/);
    assert.match(src, /select-dealership/);
    assert.match(src, /requiresDealershipSelection/);
  });

  it('apex login session supports View As enter options', () => {
    const src = readSrc('src/lib/apexLoginSession.ts');
    assert.match(src, /viewAsRole/);
    assert.match(src, /viewAsServiceAdvisorId/);
    assert.match(src, /fetchOwnerDealershipAdvisors/);
  });
});