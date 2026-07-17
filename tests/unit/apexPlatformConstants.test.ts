import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  APEX_NATIONAL_DEALERSHIP_ID,
  APEX_NATIONAL_DEALERSHIP_NAME,
  AUDIT_AUTH_SOURCES,
  AUDIT_SCOPE_MODES,
} from '../../src/lib/apex/platformConstants';

describe('apex platformConstants (Phase 5.1)', () => {
  test('sentinel dealership id matches migration seed', () => {
    assert.equal(APEX_NATIONAL_DEALERSHIP_ID, '__apex_national__');
    assert.equal(APEX_NATIONAL_DEALERSHIP_NAME, 'Apex National Platform');
  });

  test('audit enums cover fortress session fields', () => {
    assert.deepEqual([...AUDIT_AUTH_SOURCES], ['legacy', 'clerk', 'refresh']);
    // PR-G2: group scope for DealerGroup owner home (between national and dealership)
    assert.deepEqual([...AUDIT_SCOPE_MODES], ['national', 'group', 'dealership']);
  });

  test('schema includes Phase 5.1 models and fields', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const schema = fs.readFileSync(
      path.resolve(process.cwd(), 'prisma/schema.prisma'),
      'utf8'
    );
    assert.ok(schema.includes('owner'));
    assert.ok(schema.includes('apexUsername'));
    assert.ok(schema.includes('SessionRefreshToken'));
    assert.ok(schema.includes('authSource'));
    assert.ok(schema.includes('scopeMode'));
    assert.match(schema, /d7Number\s+String\?\s+@unique/);
  });
});