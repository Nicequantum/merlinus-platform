import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyResolvedDatabaseEnv,
  buildSupabasePostgresUrls,
  extractSupabaseProjectRef,
  resolveDatabaseConfig,
  shouldUseApexSupabaseDatabase,
} from '../../src/lib/apex/databaseConfig';

describe('apex database config (Phase 1.5)', () => {
  test('extractSupabaseProjectRef parses project URL', () => {
    assert.equal(
      extractSupabaseProjectRef('https://fnsuhuokwqeujepeshxh.supabase.co'),
      'fnsuhuokwqeujepeshxh'
    );
    assert.equal(extractSupabaseProjectRef('not-a-url'), null);
  });

  test('buildSupabasePostgresUrls encodes password and uses pooler host', () => {
    const urls = buildSupabasePostgresUrls({
      projectRef: 'fnsuhuokwqeujepeshxh',
      password: 'p@ss:word',
      region: 'us-east-1',
    });
    assert.ok(urls.databaseUrl.includes('postgres.fnsuhuokwqeujepeshxh'));
    assert.ok(urls.databaseUrl.includes(':6543/postgres?pgbouncer=true'));
    assert.ok(urls.databaseUrl.includes('p%40ss%3Aword'));
    assert.ok(urls.directUrl.includes(':5432/postgres'));
  });

  test('shouldUseApexSupabaseDatabase respects APEX_ENV locally', () => {
    const saved = {
      APEX_ENV: process.env.APEX_ENV,
      APEX_USE_SUPABASE_DB: process.env.APEX_USE_SUPABASE_DB,
      SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      NODE_ENV: process.env.NODE_ENV,
    };

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fnsuhuokwqeujepeshxh.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.SUPABASE_DB_PASSWORD = 'db-password';
    process.env.NODE_ENV = 'development';
    delete process.env.APEX_USE_SUPABASE_DB;
    process.env.APEX_ENV = '1';

    assert.equal(shouldUseApexSupabaseDatabase(), true);

    process.env.APEX_ENV = saved.APEX_ENV;
    process.env.APEX_USE_SUPABASE_DB = saved.APEX_USE_SUPABASE_DB;
    process.env.SUPABASE_DB_PASSWORD = saved.SUPABASE_DB_PASSWORD;
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NODE_ENV = saved.NODE_ENV;
  });

  test('shouldUseApexSupabaseDatabase respects APEX_USE_SUPABASE_DB locally', () => {
    const saved = {
      APEX_USE_SUPABASE_DB: process.env.APEX_USE_SUPABASE_DB,
      APEX_ENV: process.env.APEX_ENV,
      PLATFORM_MODE: process.env.PLATFORM_MODE,
      NEXT_PUBLIC_PLATFORM_MODE: process.env.NEXT_PUBLIC_PLATFORM_MODE,
      SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      NODE_ENV: process.env.NODE_ENV,
    };

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fnsuhuokwqeujepeshxh.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.SUPABASE_DB_PASSWORD = 'db-password';
    process.env.NODE_ENV = 'development';
    delete process.env.APEX_USE_SUPABASE_DB;
    delete process.env.APEX_ENV;
    delete process.env.PLATFORM_MODE;
    delete process.env.NEXT_PUBLIC_PLATFORM_MODE;

    assert.equal(shouldUseApexSupabaseDatabase(), false);

    process.env.APEX_USE_SUPABASE_DB = 'true';
    assert.equal(shouldUseApexSupabaseDatabase(), true);

    process.env.APEX_USE_SUPABASE_DB = saved.APEX_USE_SUPABASE_DB;
    process.env.APEX_ENV = saved.APEX_ENV;
    process.env.PLATFORM_MODE = saved.PLATFORM_MODE;
    process.env.NEXT_PUBLIC_PLATFORM_MODE = saved.NEXT_PUBLIC_PLATFORM_MODE;
    process.env.SUPABASE_DB_PASSWORD = saved.SUPABASE_DB_PASSWORD;
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NODE_ENV = saved.NODE_ENV;
  });

  test('applyResolvedDatabaseEnv switches DATABASE_URL when Apex is active', () => {
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      DIRECT_URL: process.env.DIRECT_URL,
      APEX_USE_SUPABASE_DB: process.env.APEX_USE_SUPABASE_DB,
      SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

    process.env.DATABASE_URL = 'postgresql://legacy:5432/merlinus';
    process.env.DIRECT_URL = 'postgresql://legacy:5432/merlinus';
    process.env.APEX_USE_SUPABASE_DB = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fnsuhuokwqeujepeshxh.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.SUPABASE_DATABASE_URL =
      'postgresql://postgres.fnsuhuokwqeujepeshxh:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
    delete process.env.SUPABASE_DIRECT_DATABASE_URL;

    const config = applyResolvedDatabaseEnv();
    assert.equal(config.backend, 'apex_supabase');
    assert.equal(process.env.DATABASE_URL, process.env.SUPABASE_DATABASE_URL);

    process.env.DATABASE_URL = saved.DATABASE_URL;
    process.env.DIRECT_URL = saved.DIRECT_URL;
    process.env.APEX_USE_SUPABASE_DB = saved.APEX_USE_SUPABASE_DB;
    process.env.SUPABASE_DATABASE_URL = saved.SUPABASE_DATABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved.SUPABASE_SERVICE_ROLE_KEY;
  });

  test('resolveDatabaseConfig keeps Merlinus legacy when Apex is not active', () => {
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      APEX_USE_SUPABASE_DB: process.env.APEX_USE_SUPABASE_DB,
      APEX_ENV: process.env.APEX_ENV,
      PLATFORM_MODE: process.env.PLATFORM_MODE,
      NEXT_PUBLIC_PLATFORM_MODE: process.env.NEXT_PUBLIC_PLATFORM_MODE,
      SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
      SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    };

    process.env.DATABASE_URL = 'postgresql://legacy:5432/merlinus';
    delete process.env.APEX_USE_SUPABASE_DB;
    delete process.env.APEX_ENV;
    delete process.env.PLATFORM_MODE;
    delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
    delete process.env.SUPABASE_DATABASE_URL;
    delete process.env.SUPABASE_DB_PASSWORD;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const config = resolveDatabaseConfig();
    assert.equal(config.backend, 'merlinus_legacy');
    assert.equal(config.databaseUrl, 'postgresql://legacy:5432/merlinus');

    process.env.DATABASE_URL = saved.DATABASE_URL;
    process.env.APEX_USE_SUPABASE_DB = saved.APEX_USE_SUPABASE_DB;
    process.env.APEX_ENV = saved.APEX_ENV;
    process.env.PLATFORM_MODE = saved.PLATFORM_MODE;
    process.env.NEXT_PUBLIC_PLATFORM_MODE = saved.NEXT_PUBLIC_PLATFORM_MODE;
    process.env.SUPABASE_DATABASE_URL = saved.SUPABASE_DATABASE_URL;
    process.env.SUPABASE_DB_PASSWORD = saved.SUPABASE_DB_PASSWORD;
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.NEXT_PUBLIC_SUPABASE_URL;
  });
});