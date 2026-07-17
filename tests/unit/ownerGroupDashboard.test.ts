import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());

describe('PR-G3 / PR-G4 group owner dashboard', () => {
  it('summary module exposes Tier 1 + Tier 2 fields and rooftop scorecards', () => {
    const src = readFileSync(resolve(root, 'src/lib/apex/ownerNationalSummary.ts'), 'utf8');
    assert.match(src, /repairOrders7d/);
    assert.match(src, /repairOrders30d/);
    assert.match(src, /certifiedStories7d/);
    assert.match(src, /certifiedStories30d/);
    assert.match(src, /adoptionRatePct/);
    assert.match(src, /attentionFlagCount/);
    assert.match(src, /OwnerRooftopScorecard/);
    assert.match(src, /technicianCertifiedStory/);
    assert.match(src, /rooftops/);
    // Tier 2
    assert.match(src, /volumeTrend/);
    assert.match(src, /certificationRatePct/);
    assert.match(src, /medianTimeToCertifyHours/);
    assert.match(src, /aiUsage7d/);
    assert.match(src, /logins7d/);
    assert.match(src, /staffMustChangePassword/);
    assert.match(src, /certificationTrend/);
    assert.match(src, /roDaily14d/);
    assert.match(src, /managers/);
  });

  it('owner shell renders Tier 1 + Tier 2 labels and rooftop comparison', () => {
    const src = readFileSync(
      resolve(root, 'src/components/apex/ApexOwnerNationalShell.tsx'),
      'utf8'
    );
    assert.match(src, /Rooftops active/);
    assert.match(src, /Brands \/ dealers/);
    assert.match(src, /Active staff/);
    assert.match(src, /RO volume/);
    assert.match(src, /Stories certified/);
    assert.match(src, /Adoption rate/);
    assert.match(src, /Attention flags/);
    assert.match(src, /Rooftop comparison/);
    assert.match(src, /RooftopCard/);
    assert.match(src, /apex-rooftop-grid/);
    assert.match(src, /Volume trend/);
    assert.match(src, /Certification rate/);
    assert.match(src, /Time-to-certify/);
    assert.match(src, /AI usage/);
    assert.match(src, /Login health/);
    assert.match(src, /Staff depth/);
    assert.match(src, /OwnerSparkline/);
  });

  it('CSS includes rooftop scoreboard and sparkline styles', () => {
    const css = readFileSync(resolve(root, 'src/styles/apex-platform.css'), 'utf8');
    assert.match(css, /\.apex-rooftop-grid/);
    assert.match(css, /\.apex-rooftop-card/);
    assert.match(css, /\.apex-rooftop-status--healthy/);
    assert.match(css, /\.apex-attention-list/);
    assert.match(css, /\.apex-sparkline/);
    assert.match(css, /\.apex-trend--up/);
    assert.match(css, /\.apex-stat-grid--tier2/);
  });

  it('sparkline helper component exists', () => {
    const src = readFileSync(resolve(root, 'src/components/apex/OwnerSparkline.tsx'), 'utf8');
    assert.match(src, /export function OwnerSparkline/);
    assert.match(src, /formatTrendPct/);
  });

  it('Tier 3 flags and UX polish are present (PR-G5)', () => {
    const summary = readFileSync(resolve(root, 'src/lib/apex/ownerNationalSummary.ts'), 'utf8');
    assert.match(summary, /category/);
    assert.match(summary, /portfolio_volume_drop|slow_certification|empty_portfolio/);
    assert.match(summary, /Single-manager coverage|Volume cliff|password change pending/);

    const shell = readFileSync(
      resolve(root, 'src/components/apex/ApexOwnerNationalShell.tsx'),
      'utf8'
    );
    assert.match(shell, /Tier 3/);
    assert.match(shell, /Risk, compliance/);
    assert.match(shell, /apex-section-label/);
    assert.match(shell, /All clear|No rooftops yet/);
    assert.match(shell, /Refresh metrics/);

    const docs = readFileSync(
      resolve(root, 'docs/Apex-DealerGroup-Owner-Dashboard.md'),
      'utf8'
    );
    assert.match(docs, /VITI-AUTO/);
    assert.match(docs, /viti\.james\.gray/);
    assert.match(docs, /PR-G5/);
  });
});
