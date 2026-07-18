import { existsSync, readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withSentryConfig } from '@sentry/nextjs';
import { BASE_SECURITY_HEADERS } from './security-policy.mjs';

// APEX NATIONAL PLATFORM — load .env.apex.local early when Apex is active (before Next env merge).
// Triggers on APEX_ENV=1 OR PLATFORM_MODE=apex so owner seed DB (Supabase) is always used with Apex UI.
const apexEnvFlag = ['1', 'true', 'yes'].includes(process.env.APEX_ENV?.trim().toLowerCase());
const apexPlatformFlag =
  process.env.PLATFORM_MODE?.trim().toLowerCase() === 'apex' ||
  process.env.NEXT_PUBLIC_PLATFORM_MODE?.trim().toLowerCase() === 'apex';
if (apexEnvFlag || apexPlatformFlag) {
  process.env.APEX_ENV = process.env.APEX_ENV || '1';
  process.env.PLATFORM_MODE = process.env.PLATFORM_MODE || 'apex';
  process.env.NEXT_PUBLIC_PLATFORM_MODE = process.env.NEXT_PUBLIC_PLATFORM_MODE || 'apex';
  const apexEnvPath = path.join(process.cwd(), '.env.apex.local');
  if (existsSync(apexEnvPath)) {
    for (const line of readFileSync(apexEnvPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Apex Supabase keys always win over Merlinus DATABASE_URL when Apex is active.
      process.env[key] = value;
    }
  }
}

// Permissions-Policy: camera=(self), microphone=(self), geolocation=()
// CSP (security-policy.mjs): default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveBuildCommit() {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || process.env.NEXT_PUBLIC_BUILD_COMMIT || 'dev';
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version || '3.0.0',
    NEXT_PUBLIC_BUILD_COMMIT: resolveBuildCommit(),
    NEXT_PUBLIC_BUILD_DATE: process.env.NEXT_PUBLIC_BUILD_DATE || new Date().toISOString(),
  },
  serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'pdfjs-dist': path.resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
      // Optional CF packages — not installed; prevent "Module not found" during Next build.
      '@opennextjs/cloudflare': false,
      '@cloudflare/next-on-pages': false,
    };
    return config;
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'sonner', '@sentry/nextjs'],
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async headers() {
    const isProduction =
      process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
    const securityHeaders = [
      ...(isProduction
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' }]
        : []),
      ...BASE_SECURITY_HEADERS,
    ];

    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "clarityauto",
  project: "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});