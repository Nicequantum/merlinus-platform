import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextResponse } from 'next/server';
import { setSessionCookie, SESSION_COOKIE } from '../../src/lib/auth';
import { fetchPrivateBlobAsVisionDataUrl } from '../../src/lib/blob';
import { getMockSessionCookie } from '../setup/criticalPathMocks';

/** Verifies traced CJS path next/headers -> dist/server/request/cookies is mocked before DB-dependent routes run. */
describe('next/headers cookies intercept', () => {
  test('setSessionCookie works without Next request scope error', async () => {
    await setSessionCookie('intercept-test-token');
    assert.equal(getMockSessionCookie(), 'intercept-test-token');
  });

  test('NextResponse.json still works alongside cookies mock', () => {
    const response = NextResponse.json({ ok: true });
    assert.equal(response.status, 200);
  });

  test('SESSION_COOKIE name matches jar key', async () => {
    await setSessionCookie('name-check');
    assert.equal(getMockSessionCookie(), 'name-check');
    assert.equal(SESSION_COOKIE, 'benz_tech_session');
  });

  test('blob module mock exports fetchPrivateBlobAsVisionDataUrl for ro.extract', async () => {
    assert.equal(typeof fetchPrivateBlobAsVisionDataUrl, 'function');
    const dataUrl = await fetchPrivateBlobAsVisionDataUrl('benz-tech/integration-test.png');
    assert.match(dataUrl, /^data:image\/png;base64,/);
  });
});