/** True when deployed to a production Vercel environment or NODE_ENV=production. */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

/** Bootstrap seed is never permitted in production — ALLOW_BOOTSTRAP is ignored there. */
export function isBootstrapSeedAllowed(): boolean {
  return !isProductionRuntime();
}