import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  renderApexPlainStaticSvg,
  renderApexPremiumStaticSvg,
} from '../../src/lib/apexLogo';
import { getPwaManifest } from '../../src/lib/pwaManifest';

describe('Apex platform logo assets', () => {
  test('plain and premium SVGs have no Mercedes star geometry', () => {
    const plain = renderApexPlainStaticSvg();
    const premium = renderApexPremiumStaticSvg();
    for (const svg of [plain, premium]) {
      assert.doesNotMatch(svg, /Mercedes|MERCEDES_STAR|mb-star/i);
      assert.match(svg, /512 224/); // Apex letter A peak
      assert.match(svg, /22d3ee|#22d3ee/i); // Apex cyan
    }
  });

  test('public logo.svg and plain icon are Apex-generated', () => {
    const logo = readFileSync(join(process.cwd(), 'public/logo.svg'), 'utf8');
    const plain = readFileSync(join(process.cwd(), 'public/apex-logo-plain.svg'), 'utf8');
    assert.doesNotMatch(logo, /Mercedes/i);
    assert.doesNotMatch(plain, /Mercedes/i);
    assert.match(plain, /040408|#040408/);
  });

  test('PWA manifest is Apex-branded with maskable + apple sizes', () => {
    const manifest = getPwaManifest();
    assert.match(manifest.name || '', /Apex/i);
    assert.doesNotMatch(manifest.name || '', /Mercedes/i);
    assert.equal(manifest.short_name, 'Apex');
    const srcs = (manifest.icons || []).map((i) => i.src);
    assert.ok(srcs.includes('/icon-512-maskable.png'));
    assert.ok(srcs.includes('/apple-touch-icon.png'));
    assert.ok(srcs.includes('/icon-192.png'));
  });

  test('UI components use ApexLogoMark not MercedesStarMark in headers', () => {
    const header = readFileSync(join(process.cwd(), 'src/components/AppHeader.tsx'), 'utf8');
    const loading = readFileSync(join(process.cwd(), 'src/components/LoadingScreen.tsx'), 'utf8');
    assert.match(header, /ApexLogoMark/);
    assert.doesNotMatch(header, /MerlinLogoMark|MercedesStarMark/);
    assert.match(loading, /ApexLogoMark/);
  });
});
