import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCredentialRoleAllowed } from '@/lib/apex/credentialType';
import {
  VITI_AUTO_DEALER_GROUP_CODE,
  VITI_AUTO_DEALER_CODES,
  VITI_AUTO_OWNER_DEFAULT_USERNAME,
} from '@/lib/apex/seedDealerGroups';
import { isApexUsernameCredential } from '@/lib/apex/credentialType';

const root = resolve(process.cwd());

describe('DealerGroup PR-G1', () => {
  it('exports Viti Automotive Group constants', () => {
    assert.equal(VITI_AUTO_DEALER_GROUP_CODE, 'VITI-AUTO');
    assert.deepEqual([...VITI_AUTO_DEALER_CODES], ['VITIMB', 'VITIVOLVO']);
    assert.equal(VITI_AUTO_OWNER_DEFAULT_USERNAME, 'viti.james.gray');
    assert.ok(isApexUsernameCredential(VITI_AUTO_OWNER_DEFAULT_USERNAME));
  });

  it('allows owners to authenticate with email or apex username', () => {
    assert.equal(isCredentialRoleAllowed('email', 'owner'), true);
    assert.equal(isCredentialRoleAllowed('username', 'owner'), true);
    assert.equal(isCredentialRoleAllowed('d7', 'owner'), false);
    assert.equal(isCredentialRoleAllowed('d7', 'manager'), true);
    assert.equal(isCredentialRoleAllowed('username', 'manager'), true);
    assert.equal(isCredentialRoleAllowed('email', 'manager'), false);
  });

  it('schema and migration include DealerGroup', () => {
    const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
    assert.match(schema, /model DealerGroup/);
    assert.match(schema, /model DealerGroupMembership/);
    assert.match(schema, /dealerGroupId/);

    const migration = readFileSync(
      resolve(root, 'prisma/migrations/20250714120000_apex_dealer_group/migration.sql'),
      'utf8'
    );
    assert.match(migration, /CREATE TABLE IF NOT EXISTS "DealerGroup"/);
    assert.match(migration, /DealerGroupMembership/);
  });

  it('loginResolver accepts owner username credentials', () => {
    const src = readFileSync(resolve(root, 'src/lib/apex/loginResolver.ts'), 'utf8');
    assert.match(src, /credentialType !== 'email' && credentialType !== 'username'/);
  });
});
