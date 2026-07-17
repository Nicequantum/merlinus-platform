/**
 * Integration test preload — must be plain .mjs so Node propagates it to test worker threads.
 * Usage: node/tsx --import ./tests/setup/preload.mjs
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { getCookieJar, patchCjsModuleLoader } from './cookiesMock.mjs';

if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}

getCookieJar();
patchCjsModuleLoader();

const envLocalPath = join(process.cwd(), '.env.local');
if (existsSync(envLocalPath)) {
  loadDotenv({ path: envLocalPath });
}

if (!process.env.DATA_ENCRYPTION_KEY?.trim()) {
  process.env.DATA_ENCRYPTION_KEY =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
}
if (!process.env.SEARCH_HMAC_KEY?.trim()) {
  process.env.SEARCH_HMAC_KEY =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
}

const loaderPath = join(dirname(fileURLToPath(import.meta.url)), 'server-only-loader.mjs');
register(pathToFileURL(loaderPath).href, import.meta.url);