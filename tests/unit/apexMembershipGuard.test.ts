import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { DealershipMembershipError } from '../../src/lib/apex/membershipGuard';

describe('apex membershipGuard (Phase 5.2)', () => {
  test('DealershipMembershipError has stable code', () => {
    const error = new DealershipMembershipError();
    assert.equal(error.name, 'DealershipMembershipError');
    assert.equal(error.code, 'DEALERSHIP_MEMBERSHIP_REQUIRED');
    assert.match(error.message, /membership/i);
  });

  test('schema defines TechnicianDealership with membership indexes', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    assert.ok(schema.includes('model TechnicianDealership'));
    assert.ok(schema.includes('isPrimary'));
    assert.ok(schema.includes('isActive'));
    assert.match(schema, /@@unique\(\[technicianId, dealershipId\]\)/);
    assert.match(schema, /@@index\(\[technicianId, isActive\]\)/);
    assert.ok(schema.includes('dealershipMemberships TechnicianDealership[]'));
  });

  test('migration backfills one row per technician idempotently', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20250711130000_apex_phase5_2_technician_dealership/migration.sql'
      ),
      'utf8'
    );
    assert.ok(sql.includes('CREATE TABLE'));
    assert.ok(sql.includes('"TechnicianDealership"'));
    assert.ok(sql.includes('FROM "Technician" t'));
    assert.ok(sql.includes('ON CONFLICT ("technicianId", "dealershipId") DO NOTHING'));
    assert.ok(sql.includes('"isPrimary"'));
    assert.ok(sql.includes('t."deletedAt" IS NULL'));
  });

  test('membershipGuard exports assert and sync helpers', async () => {
    const mod = await import('../../src/lib/apex/membershipGuard');
    assert.equal(typeof mod.assertDealershipMembership, 'function');
    assert.equal(typeof mod.findActiveDealershipMembership, 'function');
    assert.equal(typeof mod.listActiveDealershipMemberships, 'function');
    assert.equal(typeof mod.countActiveDealershipMemberships, 'function');
    assert.equal(typeof mod.upsertTechnicianDealershipMembership, 'function');
  });
});