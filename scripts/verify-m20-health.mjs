/**
 * Local M20 verifier — exercises CI health-check logic (no database required).
 * Usage: npx tsx --import ./tests/setup/integration.ts scripts/verify-m20-health.mjs
 */
process.env.NODE_ENV = 'test';
process.env.CI = 'true';
process.env.GITHUB_ACTIONS = 'true';
process.env.VERCEL_ENV = 'production';
process.env.GROK_API_KEY = 'ci-grok-key';
process.env.SESSION_SECRET = 'ci-test-session-secret-min-32-chars';
process.env.DATA_ENCRYPTION_KEY =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.SEARCH_HMAC_KEY =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
// Integration step clears fake job-level KV credentials.
process.env.KV_REST_API_URL = '';
process.env.KV_REST_API_TOKEN = '';

const {
  aggregateAuthenticatedHealthStatus,
  resolveAuthenticatedHealthHttpStatus,
  buildHealthServicesPayload,
  checkEncryption,
  checkGrokApi,
  checkGrokApiConnectivity,
  checkKvStore,
  checkMaintenanceMode,
  checkVoiceInput,
} = await import('../src/lib/healthChecks.ts');

const [encryption, kv, grokConfig, grok] = await Promise.all([
  checkEncryption(),
  checkKvStore(),
  checkGrokApi(),
  checkGrokApiConnectivity(),
]);

const checks = {
  database: { status: 'ok', latencyMs: 1 },
  encryption,
  kv,
  grokConfig,
  grok,
  voice: checkVoiceInput(),
  maintenance: checkMaintenanceMode(),
};

const aggregate = aggregateAuthenticatedHealthStatus(checks);
const httpStatus = resolveAuthenticatedHealthHttpStatus(checks);
const services = buildHealthServicesPayload(checks);

const failures = [];
if (httpStatus !== 200) failures.push(`HTTP status ${httpStatus} (expected 200)`);
if (!(aggregate === 'ok' || aggregate === 'degraded')) {
  failures.push(`aggregate ${aggregate} (expected ok or degraded)`);
}
if (services.voice?.status !== 'ok') failures.push(`voice ${services.voice?.status}`);
if (services.encryption?.status !== 'ok') failures.push(`encryption ${services.encryption?.status}`);
if (!services.kv) failures.push('missing kv');
if (!services.grok) failures.push('missing grok');
if (!services.grokConfig) failures.push('missing grokConfig');

if (failures.length > 0) {
  console.error('M20 health verification FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(JSON.stringify({ aggregate, httpStatus, services, checks }, null, 2));
  process.exit(1);
}

console.log('M20 health verification passed');
console.log(JSON.stringify({ httpStatus, aggregate, services }, null, 2));