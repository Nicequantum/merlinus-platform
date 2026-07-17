import {
  BLOB_MOCK_SOURCE,
  isBlobModuleRequest,
  isNextHeadersRequest,
  isRequestCookiesModule,
  isRequestCookiesUrl,
  NEXT_HEADERS_MOCK_SOURCE,
  patchCjsModuleLoader,
  REQUEST_COOKIES_MOCK_SOURCE,
} from './cookiesMock.mjs';

/** Re-apply CJS hook in every Node test worker thread. */
export async function initialize() {
  patchCjsModuleLoader();
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return {
      format: 'module',
      shortCircuit: true,
      url: 'data:text/javascript,export default undefined',
    };
  }

  if (isNextHeadersRequest(specifier)) {
    return {
      format: 'module',
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(NEXT_HEADERS_MOCK_SOURCE)}`,
    };
  }

  if (isBlobModuleRequest(specifier)) {
    return {
      format: 'module',
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(BLOB_MOCK_SOURCE)}`,
    };
  }

  const normalized = String(specifier).replace(/\\/g, '/');
  if (
    normalized.includes('next/dist/server/request/cookies') ||
    normalized.includes('next/src/server/request/cookies')
  ) {
    return {
      format: 'module',
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(REQUEST_COOKIES_MOCK_SOURCE)}`,
    };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (isRequestCookiesUrl(url)) {
    const source = String(url).includes('headers') ? NEXT_HEADERS_MOCK_SOURCE : REQUEST_COOKIES_MOCK_SOURCE;
    return {
      format: 'module',
      shortCircuit: true,
      source,
    };
  }

  return nextLoad(url, context);
}

// ESM entry: patch immediately when loader file is registered from preload.
patchCjsModuleLoader();