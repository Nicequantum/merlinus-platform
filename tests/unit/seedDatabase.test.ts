import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { describe, it } from 'node:test';
import {
  getCanonicalSeedPassword,
  PRIMARY_MANAGER_D7,
  PRIMARY_TECH_D7,
} from '@/lib/seedDatabase';

describe('seed database credentials', () => {
  it('defines canonical manager D7 and reads password from environment', () => {
    const previous = process.env.ADMIN_SEED_PASSWORD;
    process.env.ADMIN_SEED_PASSWORD = 'test-seed-password-3.0';
    try {
      assert.equal(PRIMARY_MANAGER_D7, 'D7HARRIH');
      assert.equal(PRIMARY_TECH_D7, 'D7TECH001');
      assert.equal(getCanonicalSeedPassword(), 'test-seed-password-3.0');
    } finally {
      if (previous === undefined) {
        delete process.env.ADMIN_SEED_PASSWORD;
      } else {
        process.env.ADMIN_SEED_PASSWORD = previous;
      }
    }
  });

  it('uses bcrypt hash compatible with loginTechnician verification', async () => {
    const password = 'integration-test-seed-password';
    const hash = await bcrypt.hash(password, 12);
    assert.equal(await bcrypt.compare(password, hash), true);
    assert.equal(await bcrypt.compare('wrong-password', hash), false);
  });
});