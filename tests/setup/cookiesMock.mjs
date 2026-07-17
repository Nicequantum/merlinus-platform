/**
 * Mock for next/headers cookies() — shared by CJS _load hook and ESM custom loader.
 *
 * Traced import chain from src/lib/auth.ts:
 *   auth.ts  --require-->  next/headers  (next/headers.js)
 *   headers.js  --require-->  ./dist/server/request/cookies  (real cookies impl)
 */

import { createRequire } from 'node:module';

export const COOKIE_JAR_KEY = '__MERLINUS_TEST_COOKIE_JAR__';

export function getCookieJar() {
  if (!globalThis[COOKIE_JAR_KEY]) {
    globalThis[COOKIE_JAR_KEY] = new Map();
  }
  return globalThis[COOKIE_JAR_KEY];
}

export function createMockCookieStore() {
  const jar = getCookieJar();
  const entries = () => [...jar.entries()].map(([name, value]) => ({ name, value }));

  return {
    get(name) {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name, value, _options) {
      jar.set(name, value);
    },
    delete(name) {
      jar.delete(name);
    },
    has(name) {
      return jar.has(name);
    },
    getAll() {
      return entries();
    },
    [Symbol.iterator]() {
      return entries()[Symbol.iterator]();
    },
    get size() {
      return jar.size;
    },
  };
}

/** CJS exports shape for next/dist/server/request/cookies */
export function createRequestCookiesCjsExports() {
  return { cookies: () => createMockCookieStore() };
}

/** CJS exports shape for next/headers.js */
export function createNextHeadersCjsExports() {
  return {
    cookies: () => createMockCookieStore(),
    headers: () => new Headers(),
    draftMode: () => ({ isEnabled: false }),
  };
}

function normalize(value) {
  return String(value).replace(/\\/g, '/');
}

/** Shared integration-test stub for @/lib/blob (CJS _load + ESM loader). */
export const BLOB_MOCK_SOURCE = `
export async function fetchPrivateBlobAsDataUrl() {
  return 'data:image/png;base64,aW50ZWdyYXRpb24=';
}
export async function fetchPrivateBlobAsVisionDataUrl() {
  return 'data:image/png;base64,aW50ZWdyYXRpb24=';
}
export async function uploadImageToBlob() {
  throw new Error('uploadImageToBlob not mocked for integration tests');
}
export async function streamPrivateBlob() {
  return null;
}
`;

export function isBlobModuleRequest(request) {
  const normalized = normalize(request);
  return (
    normalized.endsWith('/src/lib/blob') ||
    normalized.endsWith('/src/lib/blob.ts') ||
    request === '@/lib/blob'
  );
}

export function createBlobCjsExports() {
  const mockVisionDataUrl = async () => 'data:image/png;base64,aW50ZWdyYXRpb24=';
  return {
    fetchPrivateBlobAsDataUrl: mockVisionDataUrl,
    fetchPrivateBlobAsVisionDataUrl: mockVisionDataUrl,
    uploadImageToBlob: async () => {
      throw new Error('uploadImageToBlob not mocked for integration tests');
    },
    streamPrivateBlob: async () => null,
  };
}

export function isNextHeadersRequest(request) {
  const req = normalize(request);
  return req === 'next/headers' || req.endsWith('/next/headers') || req.endsWith('/next/headers.js');
}

/**
 * True only for the App-Route request cookies module — never web/spec-extension/cookies
 * (that module provides ResponseCookies for NextResponse.json).
 */
export function isRequestCookiesModule(request, parent) {
  const req = normalize(request);
  const parentFile = parent ? normalize(parent.filename || parent.id || '') : '';

  if (isNextHeadersRequest(request)) {
    return true;
  }

  if (req.includes('/next/dist/server/request/cookies')) {
    return true;
  }
  if (req.includes('/next/src/server/request/cookies')) {
    return true;
  }
  if (req.endsWith('/server/request/cookies') || req.endsWith('/server/request/cookies.js')) {
    return !req.includes('/web/spec-extension/');
  }

  // next/headers.js -> require('./dist/server/request/cookies')
  if (
    (req === './dist/server/request/cookies' || req === './dist/server/request/cookies.js') &&
    parentFile.includes('/next/headers')
  ) {
    return true;
  }

  return false;
}

export function isRequestCookiesUrl(url) {
  const u = normalize(url);
  if (u.includes('/next/dist/server/web/spec-extension/cookies')) {
    return false;
  }
  if (isNextHeadersRequest(url) || u.includes('/next/headers.js')) {
    return true;
  }
  return (
    u.includes('/next/dist/server/request/cookies') ||
    u.includes('/next/src/server/request/cookies')
  );
}

export const REQUEST_COOKIES_MOCK_SOURCE = `
const jar = globalThis.${COOKIE_JAR_KEY} ?? (globalThis.${COOKIE_JAR_KEY} = new Map());
function createCookieStore() {
  const entries = () => [...jar.entries()].map(([name, value]) => ({ name, value }));
  return {
    get(name) {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name, value, _options) { jar.set(name, value); },
    delete(name) { jar.delete(name); },
    has(name) { return jar.has(name); },
    getAll() { return entries(); },
    [Symbol.iterator]() { return entries()[Symbol.iterator](); },
    get size() { return jar.size; },
  };
}
export function cookies() { return createCookieStore(); }
`;

export const NEXT_HEADERS_MOCK_SOURCE = `${REQUEST_COOKIES_MOCK_SOURCE}
export function headers() { return new Headers(); }
export function draftMode() { return { isEnabled: false }; }
`;

/** Patch node:module._load — also invoked from loader initialize() in test worker threads. */
export function patchCjsModuleLoader() {
  const nodeModule = createRequire(import.meta.url)('node:module');
  if (nodeModule._load?.merlinusTestPatched) {
    return;
  }

  const originalLoad = nodeModule._load;

  function merlinusTestModuleLoad(request, parent, isMain) {
    if (request === 'server-only') {
      return {};
    }

    if (isRequestCookiesModule(request, parent)) {
      if (isNextHeadersRequest(request)) {
        return createNextHeadersCjsExports();
      }
      return createRequestCookiesCjsExports();
    }

    if (isBlobModuleRequest(request)) {
      return createBlobCjsExports();
    }

    return originalLoad.call(this, request, parent, isMain);
  }

  merlinusTestModuleLoad.merlinusTestPatched = true;
  nodeModule._load = merlinusTestModuleLoad;
}