import 'server-only';

import { createHmac } from 'crypto';

/** Minimum substring length for blind-index RO search tokens. */
const MIN_RO_SEARCH_FRAGMENT_LEN = 3;

function getSearchHmacSecret(): string {
  // Primary search HMAC key — must be set (or aliased from ENCRYPTION_KEY at env startup).
  const secret = process.env.SEARCH_HMAC_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('SEARCH_HMAC_KEY must be set (min 32 chars) for PII search tokens');
  }
  return secret;
}

/** Legacy deployments indexed RO numbers with ENCRYPTION_KEY before SEARCH_HMAC_KEY split. */
function getLegacySearchHmacSecrets(): string[] {
  const legacy = process.env.ENCRYPTION_KEY?.trim();
  if (!legacy || legacy.length < 32) return [];
  const current = getSearchHmacSecret();
  return legacy === current ? [] : [legacy];
}

function getSearchHmacSecretsForQuery(): string[] {
  const secrets = [getSearchHmacSecret(), ...getLegacySearchHmacSecrets()];
  return [...new Set(secrets)];
}

/** Normalize RO numbers for consistent blind-index hashing. */
export function normalizeRoNumberForSearch(roNumber: string): string {
  return roNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** HMAC-SHA256 blind index for a normalized RO search fragment. */
export function hashRoNumberSearchFragment(fragment: string, secret?: string): string {
  const normalized = normalizeRoNumberForSearch(fragment);
  if (!normalized) return '';
  const hmacSecret = secret ?? getSearchHmacSecret();
  return createHmac('sha256', hmacSecret)
    .update(`merlinus-ro-search:${normalized}`)
    .digest('hex');
}

function collectRoNumberFragmentTokens(normalized: string, secret: string, tokens: Set<string>): void {
  for (let len = MIN_RO_SEARCH_FRAGMENT_LEN; len <= normalized.length; len += 1) {
    for (let start = 0; start <= normalized.length - len; start += 1) {
      const token = hashRoNumberSearchFragment(normalized.slice(start, start + len), secret);
      if (token) tokens.add(token);
    }
  }
}

/** Build all substring blind-index tokens for an RO number (supports contains search). */
export function buildRoNumberSearchTokens(roNumber: string): string[] {
  const normalized = normalizeRoNumberForSearch(roNumber);
  if (!normalized) return [];

  const tokens = new Set<string>();
  for (const secret of getSearchHmacSecretsForQuery()) {
    collectRoNumberFragmentTokens(normalized, secret, tokens);
  }

  return Array.from(tokens);
}

/**
 * Build query tokens from a user search term for SQLite/D1 `contains` matching
 * on the stored JSON token blob.
 *
 * Store side indexes ALL substrings of the RO number. Query side only needs the
 * hash of the **full search term** (plus legacy secrets). Expanding query-side
 * substrings creates dozens of OR LIKE clauses and triggers D1
 * "LIKE or GLOB pattern too complex".
 */
export function buildRoNumberSearchQueryTokens(term: string): string[] {
  const normalized = normalizeRoNumberForSearch(term);
  if (!normalized) return [];

  const tokens = new Set<string>();
  for (const secret of getSearchHmacSecretsForQuery()) {
    const token = hashRoNumberSearchFragment(normalized, secret);
    if (token) tokens.add(token);
  }
  return Array.from(tokens);
}
