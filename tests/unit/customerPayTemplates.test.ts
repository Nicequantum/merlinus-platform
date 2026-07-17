import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDIT_CUSTOMER_PAY_SENTINEL,
  computeAuditEntryHash,
  verifyAuditChain,
  AUDIT_GENESIS_HASH,
  type AuditChainPayload,
} from '@/lib/auditChain';
import { CRITICAL_AUDIT_ACTIONS, CUSTOMER_PAY_AUDIT_ACTIONS, STORY_PROMPT_AUDIT_ACTIONS } from '@/lib/audit';
import { CUSTOMER_PAY_TEMPLATES, templateRowIsCustomerPay } from '@/prompts/templates/customerPayTemplates';
import { isCustomerPayStoryTemplate } from '@/lib/templateLibrary';
import type { StoryTemplate } from '@/types';

describe('Customer Pay templates', () => {
  it('includes at least 12 professionally written templates', () => {
    assert.ok(CUSTOMER_PAY_TEMPLATES.length >= 12);
    const titles = CUSTOMER_PAY_TEMPLATES.map((t) => t.title);
    assert.equal(new Set(titles).size, titles.length);
    for (const t of CUSTOMER_PAY_TEMPLATES) {
      assert.ok(t.description.trim().length > 10);
      assert.ok(t.preWrittenStory.trim().length > 80);
      assert.ok(t.preWrittenStory.startsWith('Performed'));
    }
  });

  it('identifies customer pay template rows by explicit flag only (H14)', () => {
    assert.equal(
      templateRowIsCustomerPay({ isCustomerPay: true, templateType: 'CustomerPay', category: 'customer' }),
      true
    );
    assert.equal(
      templateRowIsCustomerPay({ isCustomerPay: false, templateType: 'CustomerPay', category: 'customer' }),
      false
    );
    assert.equal(
      templateRowIsCustomerPay({ isCustomerPay: false, templateType: 'Warranty', category: 'warranty' }),
      false
    );
  });

  it('isCustomerPayStoryTemplate matches StoryTemplate flags', () => {
    const cp: StoryTemplate = {
      id: '1',
      title: 'Front Brake Job',
      category: 'customer',
      content: 'story',
      isCustomerPay: true,
      templateType: 'CustomerPay',
      createdAt: new Date().toISOString(),
    };
    assert.equal(isCustomerPayStoryTemplate(cp), true);
  });
});

describe('Customer Pay audit compliance', () => {
  it('uses customerPayTemplateApplied outside Merlin story prompt actions', () => {
    assert.ok(CUSTOMER_PAY_AUDIT_ACTIONS.has('customerPayTemplateApplied'));
    assert.equal(STORY_PROMPT_AUDIT_ACTIONS.has('customerPayTemplateApplied'), false);
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('customerPayTemplateApplied'));
  });

  it('hash chain accepts customer-pay sentinel without Merlin PROMPT_VERSION', () => {
    const first: AuditChainPayload = {
      id: 'cp-audit-1',
      action: 'customerPayTemplateApplied',
      entityType: 'repairLine',
      entityId: 'line-1',
      technicianId: 'tech-1',
      dealershipId: 'dealer-1',
      metadata: JSON.stringify({ templateId: 'tpl-1', templateTitle: 'Front Brake Job' }),
      ipAddress: '127.0.0.1',
      createdAt: new Date().toISOString(),
      previousHash: AUDIT_GENESIS_HASH,
      promptVersion: AUDIT_CUSTOMER_PAY_SENTINEL,
    };
    const firstHash = computeAuditEntryHash(first);
    const chain = verifyAuditChain([{ ...first, entryHash: firstHash }]);
    assert.equal(chain.valid, true);
    assert.notEqual(first.promptVersion, '2.1.0');
  });
});