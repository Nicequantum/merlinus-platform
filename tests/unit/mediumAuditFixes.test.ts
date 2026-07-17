import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { JWT_AUDIENCE, JWT_ISSUER } from '@/lib/auth';
import { sanitizeAuditMetadata } from '@/lib/auditMetadataSanitize';
import { buildPromptAuditFingerprint } from '@/lib/promptFingerprint';
import { getClientIp } from '@/lib/rate-limit';
import { DAILY_USAGE_LIMIT } from '@/lib/usageMonitoring';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Medium audit fixes (M1–M30)', () => {
  it('M1: clear Customer Pay API and UI', () => {
    assert.ok(readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/clear-customer-pay/route.ts').includes('clearCustomerPayMode'));
    assert.ok(readSrc('src/components/LineView.tsx').includes('Switch to warranty AI'));
  });

  it('M2/M3: transactional idempotent Customer Pay apply', () => {
    const src = readSrc('src/lib/customerPayTemplate.ts');
    // Phase 6: rlsTransaction for ambient RLS when withSessionRls is active
    assert.ok(src.includes('rlsTransaction') || src.includes('prisma.$transaction'));
    assert.ok(src.includes('isDuplicateTemplateApply'));
  });

  it('M4/M5: warranty KB filter and customer pay generation guard', () => {
    assert.ok(readSrc('src/lib/templateLibrary.ts').includes("entry.category !== 'customer'"));
    // Phase 7.3 — customer-pay guard lives in withStoryAiRoute shell
    const gen = readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts');
    const shell = readSrc('src/lib/storyAiRoute.ts');
    assert.ok(
      gen.includes('isCustomerPayRepairLine') ||
        gen.includes('withStoryAiRoute') ||
        shell.includes('isCustomerPayRepairLine')
    );
  });

  it('M6: prompt fingerprint metadata', () => {
    const fp = buildPromptAuditFingerprint();
    assert.ok(fp.systemPromptHash);
    assert.ok(fp.miGuidelinesHash);
  });

  it('M7: expanded field encryption columns', () => {
    const schema = readSrc('prisma/schema.prisma');
    assert.ok(schema.includes('roNumberEncrypted'));
    assert.ok(schema.includes('descriptionEncrypted'));
  });

  it('M9: JWT iss/aud constants', () => {
    assert.equal(JWT_ISSUER, 'merlin');
    assert.equal(JWT_AUDIENCE, 'benz-tech-session');
    assert.ok(readSrc('src/lib/auth.ts').includes('setJti'));
  });

  it('M10: GET logout blocked', () => {
    assert.ok(readSrc('src/app/api/auth/logout/route.ts').includes('405'));
  });

  it('M11: TechnicianRole enum', () => {
    assert.ok(readSrc('prisma/schema.prisma').includes('enum TechnicianRole'));
  });

  it('M12: CSP middleware blocks eval', () => {
    const policy = readSrc('security-policy.mjs');
    const mw = readSrc('src/middleware.ts');
    const nextCfg = readSrc('next.config.mjs');
    assert.ok(policy.includes("'unsafe-inline'"));
    assert.equal(policy.includes('unsafe-eval'), false);
    assert.equal(nextCfg.includes('unsafe-eval'), false);
    assert.ok(policy.includes("manifest-src 'self' data:"));
    assert.ok(policy.includes('https://*.sentry.io'));
    assert.ok(policy.includes('connect-src'));
    assert.equal(policy.includes('https://vercel.com'), false);
    assert.ok(mw.includes('security-policy.mjs'));
  });

  it('M13/Phase 6.3: audit metadata allowlist-only + RO hash', () => {
    const sanitized = sanitizeAuditMetadata({
      name: 'Jane',
      serviceAdvisorId: 'sa-1',
      roNumber: 'RO-12345',
      freeText: 'should drop',
      certifiedByName: 'Alex',
    });
    assert.equal('name' in sanitized, false);
    assert.equal('roNumber' in sanitized, false);
    assert.equal('freeText' in sanitized, false);
    assert.equal('certifiedByName' in sanitized, false);
    assert.equal(sanitized.serviceAdvisorId, 'sa-1');
    assert.equal(typeof sanitized.roNumberHash, 'string');
    assert.equal((sanitized.roNumberHash as string).length, 32);
  });

  it('M14: trusted IP extraction', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-vercel-forwarded-for': '203.0.113.10' },
    });
    assert.equal(getClientIp(req), '203.0.113.10');
  });

  it('M15/M16/M17: voice service guards', () => {
    const voice = readSrc('src/lib/voice/VoiceInputService.ts');
    assert.ok(voice.includes('attachManualEditGuard'));
    assert.ok(voice.includes('processDictationChunk'));
    assert.ok(voice.includes('dictationMode'));
    assert.ok(voice.includes('Do not call getUserMedia before SpeechRecognition'));
    assert.ok(readSrc('src/hooks/useVoiceInput.ts').includes('pagehide'));
    assert.ok(readSrc('src/components/VoiceInputProvider.tsx').includes('VoiceInputProvider'));
  });

  it('M18: long-form dictation without short listening cutoff', () => {
    const voice = readSrc('src/lib/voice/voiceSettings.ts');
    assert.equal(voice.includes('45_000'), false);
    assert.ok(voice.includes('listeningTimeoutMs: 0') || voice.includes('maxAutoRestarts: 60'));
  });

  it('M21: useRepairOrders split into focused hooks', () => {
    assert.ok(readSrc('src/hooks/repairOrders/useROPersistence.ts').includes('useROPersistence'));
    assert.ok(readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts').includes('useROStoryWorkflow'));
    assert.ok(readSrc('src/hooks/repairOrders/roImageUtils.ts').includes('removeImageAtIndex'));
    assert.ok(readSrc('src/hooks/repairOrders/roXentryAnalysis.ts').includes('analyzeXentryImage'));
    assert.ok(readSrc('src/hooks/repairOrders/currentLineStoryState.ts').includes('deriveCurrentLineStoryState'));
    assert.ok(readSrc('src/lib/lineViewUtils.ts').includes('readWarrantyStoryText'));
    assert.ok(readSrc('src/hooks/lineView/useLineViewPdfExport.ts').includes('useLineViewPdfExport'));
  });

  it('M22/M23: images route uses withAuth', () => {
    assert.ok(readSrc('src/app/api/images/route.ts').includes('withAuth'));
  });

  it('M25: session probe does not demote on timeout (loginSession, not dead useSession)', () => {
    const src = readSrc('src/lib/loginSession.ts');
    assert.match(src, /probeCurrentSession/);
    assert.match(src, /status: 'timeout'/);
    assert.match(src, /status: 'unauthorized'/);
  });

  it('M26: batched reencrypt script', () => {
    assert.ok(readSrc('scripts/reencrypt-legacy-data.ts').includes('BATCH_SIZE'));
  });

  it('M28/M29: usage limit and timezone env', () => {
    assert.ok(DAILY_USAGE_LIMIT >= 1);
    // Phase 7.3 — USAGE_TIMEZONE resolved via dealershipDayBoundary helpers
    const usage = readSrc('src/lib/usageMonitoring.ts');
    const day = readSrc('src/lib/dealershipDayBoundary.ts');
    assert.ok(
      usage.includes('USAGE_TIMEZONE') ||
        day.includes('USAGE_TIMEZONE') ||
        usage.includes('resolveDealershipTimezone')
    );
  });

  it('M30: reencryption runbook doc', () => {
    assert.ok(readFileSync(resolve(root, 'docs/Reencryption-Runbook.md'), 'utf8').includes('db:reencrypt'));
  });
});