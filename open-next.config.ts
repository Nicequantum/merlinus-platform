import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext Cloudflare adapter config.
 * Incremental cache can later use R2 via overrides; default is fine for first deploy.
 */
export default defineCloudflareConfig({});
