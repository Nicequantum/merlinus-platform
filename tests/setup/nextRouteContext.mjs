import { NextRequest } from 'next/server';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external.js';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external.js';
import { createRequestStoreForAPI } from 'next/dist/server/async-storage/request-store.js';
import { createWorkStore } from 'next/dist/server/async-storage/work-store.js';

export const LAST_REQUEST_STORE_KEY = '__MERLINUS_LAST_REQUEST_STORE__';

const EMPTY_IMPLICIT_TAGS = { tags: [], expirationsByCacheKind: new Map() };
const EMPTY_PREVIEW_PROPS = {
  previewModeId: '',
  previewModeSigningKey: '',
  previewModeEncryptionKey: '',
};

function toNextRequest(request) {
  if (request instanceof NextRequest) {
    return request;
  }
  return new NextRequest(request);
}

/**
 * Runs an App Route handler with the same AsyncLocalStorage request context Next.js uses in production.
 * This makes next/headers cookies() work in integration tests without brittle module mocks.
 */
export async function runWithNextRouteContext(request, routePage, handler) {
  const nextReq = toNextRequest(request);
  const requestStore = createRequestStoreForAPI(
    nextReq,
    {
      pathname: nextReq.nextUrl.pathname,
      search: nextReq.nextUrl.search ?? '',
    },
    EMPTY_IMPLICIT_TAGS,
    undefined,
    EMPTY_PREVIEW_PROPS
  );

  globalThis[LAST_REQUEST_STORE_KEY] = requestStore;

  const workStore = createWorkStore({
    page: routePage,
    renderOpts: {
      shouldWaitOnAllReady: true,
      supportsDynamicResponse: true,
      isDraftMode: false,
      isPossibleServerAction: false,
      dev: false,
      experimental: { cacheComponents: false },
    },
    buildId: 'integration-test',
    previouslyRevalidatedTags: [],
  });

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, () => handler(nextReq))
  );
}