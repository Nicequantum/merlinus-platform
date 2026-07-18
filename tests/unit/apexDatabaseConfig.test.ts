import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import {
  applyResolvedDatabaseEnv,
  extractSupabaseProjectRef,
  resolveDatabaseConfig,
  shouldUseApexSupabaseDatabase,
  isApexSupabasePostgresConfigured,
} from '@/lib/apex/databaseConfig';

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe('apex database config (Cloudflare D1)', () => {
  it('extractSupabaseProjectRef still parses project URL (compat helper)', () => {
    assert.equal(
      extractSupabaseProjectRef('https://fnsuhuokwqeujepeshxh.supabase.co'),
      'fnsuhuokwqeujepeshxh'
    );
    assert.equal(extractSupabaseProjectRef('not-a-url'), null);
  });

  it('never routes Prisma to Supabase Postgres', () => {
    process.env.APEX_ENV = '1';
    process.env.SUPABASE_DATABASE_URL = 'postgresql://user:pass@host/db';
    process.env.PLATFORM_MODE = 'apex';
    assert.equal(isApexSupabasePostgresConfigured(), false);
    assert.equal(shouldUseApexSupabaseDatabase(), false);
  });

  it('resolveDatabaseConfig prefers local sqlite file URL for tooling', () => {
    delete process.env.DATABASE_URL;
    const config = resolveDatabaseConfig();
    assert.equal(config.backend, 'sqlite_file');
    assert.equal(config.databaseUrl, 'file:./prisma/dev.db');
    assert.equal(config.directUrl, null);
  });

  it('applyResolvedDatabaseEnv sets file URL when unset', () => {
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_URL;
    const config = applyResolvedDatabaseEnv();
    assert.equal(config.backend, 'sqlite_file');
    assert.equal(process.env.DATABASE_URL, 'file:./prisma/dev.db');
    assert.equal(process.env.DIRECT_URL, undefined);
  });

  it('rejects PostgreSQL DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/merlin';
    assert.throws(() => resolveDatabaseConfig(), /PostgreSQL/);
  });
});
