import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NextResponse } from 'next/server';
import { applySessionCookieToResponse, SESSION_COOKIE } from '@/lib/auth';

describe('login session cookie', () => {
  it('attaches session cookie to NextResponse for route handlers', () => {
    const response = NextResponse.json({ session: { technicianId: 'tech-1' } });
    applySessionCookieToResponse(response, 'signed-jwt-token');

    const cookie = response.cookies.get(SESSION_COOKIE);
    assert.ok(cookie);
    assert.equal(cookie?.value, 'signed-jwt-token');
    assert.equal(cookie?.httpOnly, true);
    assert.equal(cookie?.path, '/');
  });
});