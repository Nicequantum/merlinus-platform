import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  HUB_APPOINTMENT_CATEGORIES,
  HUB_INSIGHT_PROMPT_VERSION,
} from '../../src/lib/hub/constants';
import { parseJsonArray, parseJsonObject } from '../../src/lib/hub/mappers';
import { mintShareToken } from '../../src/lib/hub/share';

const root = resolve(process.cwd());

describe('Unified Calendar & Conversation Hub', () => {
  test('schema defines hub models', () => {
    const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
    assert.match(schema, /model ServiceAppointment/);
    assert.match(schema, /model ConversationInsight/);
    assert.match(schema, /model HubAuditEvent/);
  });

  test('categories and insight version', () => {
    assert.ok(HUB_APPOINTMENT_CATEGORIES.includes('service'));
    assert.equal(HUB_INSIGHT_PROMPT_VERSION, 'hub-insight-v1');
  });

  test('share tokens are opaque and hashed', () => {
    const a = mintShareToken();
    const b = mintShareToken();
    assert.ok(a.raw.length >= 24);
    assert.equal(a.hash.length, 64);
    assert.notEqual(a.raw, b.raw);
    assert.notEqual(a.hash, a.raw);
  });

  test('json helpers are defensive', () => {
    assert.deepEqual(parseJsonArray('["a","b"]'), ['a', 'b']);
    assert.deepEqual(parseJsonArray('nope'), []);
    assert.equal(parseJsonObject('{"x":1}').x, 1);
    assert.deepEqual(parseJsonObject('bad'), {});
  });

  test('hub routes and public portal exist', () => {
    const timeline = readFileSync(
      resolve(root, 'src/app/api/hub/timeline/route.ts'),
      'utf8'
    );
    assert.match(timeline, /buildHubTimeline/);
    const portal = readFileSync(
      resolve(root, 'src/app/api/public/hub/appointment/[token]/route.ts'),
      'utf8'
    );
    assert.match(portal, /shareTokenHash/);
    const publicRoutes = readFileSync(resolve(root, 'src/lib/publicRoutes.ts'), 'utf8');
    assert.match(publicRoutes, /\/portal/);
    assert.match(publicRoutes, /api\/public\/hub/);
  });

  test('RLS includes hub models', () => {
    const rls = readFileSync(resolve(root, 'src/lib/apex/rlsPrismaExtension.ts'), 'utf8');
    assert.match(rls, /ServiceAppointment/);
    assert.match(rls, /ConversationInsight/);
    assert.match(rls, /HubAuditEvent/);
  });
});
