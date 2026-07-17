import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  emailsMatchForClerkLink,
  extractClerkPrimaryEmail,
  normalizeAuthEmail,
} from '../../src/lib/clerkEmail';

describe('clerk identity (Phase 4 PR-3)', () => {
  test('normalizeAuthEmail lowercases and trims', () => {
    assert.equal(normalizeAuthEmail('  Admin@Dealership.COM '), 'admin@dealership.com');
  });

  test('extractClerkPrimaryEmail prefers primary email address id', () => {
    const email = extractClerkPrimaryEmail({
      primary_email_address_id: 'eml_2',
      email_addresses: [
        { id: 'eml_1', email_address: 'other@dealership.com' },
        { id: 'eml_2', email_address: 'Primary@Dealership.com' },
      ],
    });

    assert.equal(email, 'primary@dealership.com');
  });

  test('extractClerkPrimaryEmail falls back to first address', () => {
    const email = extractClerkPrimaryEmail({
      email_addresses: [{ id: 'eml_1', email_address: 'tech@dealership.com' }],
    });

    assert.equal(email, 'tech@dealership.com');
  });

  test('emailsMatchForClerkLink compares normalized emails', () => {
    assert.equal(
      emailsMatchForClerkLink('Hombre3536@gmail.com', 'hombre3536@gmail.com'),
      true
    );
    assert.equal(emailsMatchForClerkLink('a@dealership.com', 'b@dealership.com'), false);
  });
});