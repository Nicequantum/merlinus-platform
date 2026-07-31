import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  parseBillingPeriod,
  resolveBillingRates,
} from '@/lib/apex/ownerBillingSummary';

const root = resolve(process.cwd());

describe('owner national billing meters', () => {
  it('defaults to fair story + platform packaging', () => {
    const rates = resolveBillingRates({});
    assert.equal(rates.platformMonthlyCents, 29_900);
    assert.equal(rates.storyFirstCents, 95);
    assert.equal(rates.storyHighVolumeCents, 65);
    assert.equal(rates.highVolumeThreshold, 400);
    assert.equal(rates.storyRegenCents, 25);
    assert.equal(rates.smsCents, 4);
    assert.equal(rates.currency, 'USD');
  });

  it('honors BILLING_* env overrides', () => {
    const rates = resolveBillingRates({
      BILLING_PLATFORM_MONTHLY_CENTS: '19900',
      BILLING_STORY_FIRST_CENTS: '125',
      BILLING_STORY_HIGH_VOLUME_CENTS: '60',
      BILLING_HIGH_VOLUME_THRESHOLD: '500',
      BILLING_STORY_REGEN_CENTS: '30',
      BILLING_SMS_CENTS: '5',
      BILLING_CURRENCY: 'usd',
    } as NodeJS.ProcessEnv);
    assert.equal(rates.platformMonthlyCents, 19_900);
    assert.equal(rates.storyFirstCents, 125);
    assert.equal(rates.storyHighVolumeCents, 60);
    assert.equal(rates.highVolumeThreshold, 500);
    assert.equal(rates.storyRegenCents, 30);
    assert.equal(rates.smsCents, 5);
    assert.equal(rates.currency, 'USD');
  });

  it('parses period query values', () => {
    assert.equal(parseBillingPeriod('7d'), '7d');
    assert.equal(parseBillingPeriod('month'), 'month');
    assert.equal(parseBillingPeriod('mtd'), 'month');
    assert.equal(parseBillingPeriod(null), '30d');
    assert.equal(parseBillingPeriod('nope'), '30d');
  });

  it('exposes owner-only billing API and national shell tab', () => {
    const route = readFileSync(resolve(root, 'src/app/api/owner/billing/route.ts'), 'utf8');
    assert.match(route, /requireOwner:\s*true/);
    assert.match(route, /requireOwnerNational:\s*true/);
    assert.match(route, /getOwnerBillingSummary/);

    const shell = readFileSync(
      resolve(root, 'src/components/apex/ApexOwnerNationalShell.tsx'),
      'utf8'
    );
    assert.match(shell, /National billing meters/);
    assert.match(shell, /fetchOwnerBillingSummary/);
  });

  it('meters first stories from UsageEvent and activity from AuditLog', () => {
    const src = readFileSync(resolve(root, 'src/lib/apex/ownerBillingSummary.ts'), 'utf8');
    assert.match(src, /story_generated/);
    assert.match(src, /usageEvent\.groupBy/);
    assert.match(src, /auditLog\.groupBy/);
    assert.match(src, /story\.generate/);
    assert.match(src, /video\.sms_send/);
  });
});
