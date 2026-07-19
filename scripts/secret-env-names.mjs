/**
 * Server-only secrets that must NEVER be baked into OpenNext next-env.mjs
 * or NEXT_PUBLIC_* client bundles. Supply at runtime via:
 *   npx wrangler secret put <NAME>
 * or Cloudflare dashboard → Workers → merlinus-platform → Settings → Variables.
 *
 * NEXT_PUBLIC_* (non-secret) may remain in .env.local for builds.
 */
export const RUNTIME_ONLY_SECRET_NAMES = [
  // Core crypto / session
  'SESSION_SECRET',
  'SESSION_IP_SALT',
  'DATA_ENCRYPTION_KEY',
  'SEARCH_HMAC_KEY',
  'ENCRYPTION_KEY',
  'ENCRYPTION_SALT',
  // AI / media (R2 uses Worker binding APEX_R2; optional S3-compat keys for tooling)
  'GROK_API_KEY',
  'XAI_API_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  // Rate limit KV
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  // Apex / platform
  'APEX_ENV',
  'PLATFORM_MODE',
  // PLATFORM_MODE is also needed server-side; client uses NEXT_PUBLIC_PLATFORM_MODE only.
  'OWNER_SEED_EMAIL',
  'OWNER_SEED_PASSWORD',
  'OWNER_SEED_NAME',
  'OWNER_SEED_EMAIL_2',
  'OWNER_SEED_PASSWORD_2',
  'OWNER_SEED_NAME_2',
  'MULTI_ROOFTOP_SEED_USERNAME',
  'MULTI_ROOFTOP_SEED_PASSWORD',
  'MULTI_ROOFTOP_SEED_NAME',
  'VITI_AUTO_OWNER_PASSWORD',
  'VITI_AUTO_OWNER_USERNAME',
  'VITI_AUTO_OWNER_EMAIL',
  'VITI_AUTO_OWNER_NAME',
  'APEX_PLATFORM_OWNER_EMAILS',
  // Seed / bootstrap
  'ADMIN_SEED_PASSWORD',
  'TECH_SEED_PASSWORD',
  'ADMIN_SEED_D7',
  'TECH_SEED_D7',
  'ADMIN_SEED_EMAIL',
  'TECH_SEED_EMAIL',
  'SETUP_SECRET',
  'ALLOW_BOOTSTRAP',
  // Auth providers
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SECRET',
  // Twilio / SMS
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_API_KEY',
  'TWILIO_API_SECRET',
  // Grok proxy machine
  'GROK_PROXY_API_KEY',
  'GROK_PROXY_ALLOW_STATIC_BEARER',
  // Supabase service
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DATABASE_URL',
  'SUPABASE_DB_PASSWORD',
  // Sentry (server auth token only — DSN can be public)
  'SENTRY_AUTH_TOKEN',
  // Deploy posture
  'MERLIN_PRODUCTION',
  'ACCESS_TOKEN_TTL_SECONDS',
  'REFRESH_TOKEN_TTL_SECONDS',
];

/** Values that indicate placeholders — fail production validation. */
export const PLACEHOLDER_VALUE_PATTERNS = [
  /^xai-your/i,
  /^your[-_]/i,
  /example\.com/i,
  /change-?me/i,
  /placeholder/i,
  /xxxx+/i,
  /vercel_blob_rw_\.\.\./i,
  /your-kv-instance/i,
  /your-key@/i,
  /o0\.ingest\.sentry\.io\/0/i,
];

export function looksLikePlaceholder(value) {
  const v = String(value ?? '').trim();
  if (!v) return true;
  return PLACEHOLDER_VALUE_PATTERNS.some((re) => re.test(v));
}
