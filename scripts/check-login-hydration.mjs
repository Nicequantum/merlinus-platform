/**
 * Browser smoke test: login shell must be visible after client hydration.
 * Requires: npx playwright install chromium (one-time).
 */
import { chromium } from 'playwright';

const baseUrl = process.env.MERLIN_BASE_URL ?? 'http://localhost:3457';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 });

  const loginShell = page.locator('.login-shell');
  await loginShell.waitFor({ state: 'visible', timeout: 10_000 });

  const d7 = page.getByLabel('Mercedes-Benz D7 Number');
  const signIn = page.getByRole('button', { name: 'Sign in' });

  if (!(await d7.isVisible()) || !(await signIn.isVisible())) {
    console.error('[login-hydration] Login fields not visible after hydration');
    process.exit(1);
  }

  const cspViolations = consoleErrors.filter((line) =>
    /content security policy|csp/i.test(line)
  );
  if (cspViolations.length > 0) {
    console.error('[login-hydration] CSP console errors:', cspViolations.join('\n'));
    process.exit(1);
  }

  if (consoleErrors.length > 0) {
    console.error('[login-hydration] Console errors:', consoleErrors.join('\n'));
    process.exit(1);
  }

  console.log('[login-hydration] OK — login shell visible after hydration');
} finally {
  await browser.close();
}