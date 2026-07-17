import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { CRITICAL_AUDIT_ACTIONS } from '@/lib/audit';
import { shouldAutoRestartAfterError } from '@/lib/voice/errors';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Critical audit fixes (C1–C7)', () => {
  it('C1: repairLineSchema includes isCustomerPay', () => {
    const src = readSrc('src/lib/validation.ts');
    assert.ok(src.includes('isCustomerPay: z.boolean().optional()'));
  });

  it('C1: PUT handler merges persisted isCustomerPay', () => {
    const src = readSrc('src/app/api/repair-orders/[id]/route.ts');
    assert.ok(src.includes('existingLine?.isCustomerPay'));
    assert.ok(src.includes('isCustomerPay,'));
  });

  it('C2: compliance-critical audit actions are defined', () => {
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('ro.extract'));
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('diagnostics.extract'));
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('story.generate'));
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('story.score'));
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('story.review'));
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('story.edit'));
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('customerPayTemplateApplied'));
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('auth.login'));
    const auditSrc = readSrc('src/lib/audit.ts');
    assert.ok(auditSrc.includes('CRITICAL_AUDIT_ACTIONS.has(input.action)'));
  });

  it('C3b: story.edit audits before repairLine.update with before/after hashes', () => {
    const src = readSrc('src/app/api/repair-orders/[id]/route.ts');
    const auditIdx = src.indexOf("action: 'story.edit'");
    const updateIdx = src.indexOf('repairLine.update');
    assert.ok(auditIdx !== -1 && updateIdx !== -1);
    assert.ok(auditIdx < updateIdx);
    assert.ok(src.includes('appendAuditLogInTransaction'));
    assert.ok(src.includes('previousStoryHash'));
    assert.ok(src.includes('hashWarrantyStory'));
  });

  it('C3: generate-story atomically persists audit and repair line in one transaction', () => {
    const src = readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts');
    assert.ok(src.includes("action: 'story.generate'"));
    assert.ok(src.includes('persistRepairLineStoryInTransaction'));
    // Phase 6: rlsTransaction wraps the RLS-scoped Prisma transaction
    assert.ok(src.includes('rlsTransaction') || src.includes('prisma.$transaction'));
  });

  it('C4: security-status requires manager auth', () => {
    const src = readSrc('src/app/api/auth/security-status/route.ts');
    assert.ok(src.includes('withAuth('));
    assert.ok(src.includes('requireManager: true'));
  });

  it('C5: health is authenticated and avoids costly Grok completion probes', () => {
    const healthRoute = readSrc('src/app/api/health/route.ts');
    const healthChecks = readSrc('src/lib/healthChecks.ts');
    assert.ok(healthRoute.includes('withAuth('));
    assert.ok(healthRoute.includes('runAuthenticatedHealthChecks'));
    assert.ok(healthChecks.includes('checkGrokApiConnectivity'));
    assert.ok(healthChecks.includes('buildHealthServicesPayload'));
    assert.equal(healthChecks.includes('chat/completions'), false);
  });

  it('C6: voice session coordinator is wired', () => {
    const coord = readSrc('src/lib/voice/voiceSessionCoordinator.ts');
    const service = readSrc('src/lib/voice/VoiceInputService.ts');
    assert.ok(coord.includes('claimVoiceSession'));
    assert.ok(service.includes('claimVoiceSession'));
  });

  it('C7: aborted errors do not auto-restart and handlers are disposed', () => {
    assert.equal(shouldAutoRestartAfterError('aborted', 0, 10), false);
    const service = readSrc('src/lib/voice/VoiceInputService.ts');
    assert.ok(service.includes('disposeRecognition'));
    assert.ok(service.includes('supersedingRecognition'));
  });
});