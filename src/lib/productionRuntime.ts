/** True when deployed to a production Vercel environment or NODE_ENV=production. */
export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.MERLIN_PRODUCTION === '1' ||
    process.env.MERLIN_PRODUCTION === 'true'
  );
}

/** Bootstrap seed is never permitted in production — ALLOW_BOOTSTRAP is ignored there. */
export function isBootstrapSeedAllowed(): boolean {
  return !isProductionRuntime();
}
