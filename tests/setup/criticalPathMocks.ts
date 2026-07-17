import { COOKIE_JAR_KEY, getCookieJar } from './cookiesMock.mjs';
import { runWithNextRouteContext } from './nextRouteContext.mjs';

const SESSION_COOKIE = 'benz_tech_session';

type RequestStoreRef = {
  mutableCookies?: { get: (name: string) => { value: string } | undefined };
};

export function getMockSessionCookie(): string | undefined {
  const fromJar = getCookieJar().get(SESSION_COOKIE);
  if (fromJar) {
    return fromJar;
  }

  const store = (globalThis as typeof globalThis & Record<string, unknown>)[
    '__MERLINUS_LAST_REQUEST_STORE__'
  ] as RequestStoreRef | undefined;
  return store?.mutableCookies?.get(SESSION_COOKIE)?.value;
}

export function clearCriticalPathMocks(): void {
  getCookieJar().clear();
  delete (globalThis as typeof globalThis & Record<string, unknown>).__MERLINUS_LAST_REQUEST_STORE__;
}

export { COOKIE_JAR_KEY, runWithNextRouteContext };