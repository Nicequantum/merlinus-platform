/**
 * In-app data encryption key (DEK) keyring.
 *
 * - DATA_ENCRYPTION_KEY (env) = long-lived KEK (key-encryption key) — ops rarely changes this.
 * - DEKs live in EncryptionKeyring, wrapped with the KEK, and power encryptPII/decryptPII.
 * - Managers rotate DEKs from Settings with no Worker secret edits.
 */
import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { logger } from '@/lib/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEYRING_ID = 'global';

export type KeyringSnapshot = {
  primarySecret: string;
  previousSecret: string | null;
  primaryFingerprint: string;
  previousFingerprint: string | null;
  version: number;
  lastRotatedAt: string | null;
  /** True when DEKs are loaded from DB (not pure env bootstrap). */
  inAppActive: boolean;
  dualKeyActive: boolean;
};

type CacheState = KeyringSnapshot & { loadedAt: number };

let cache: CacheState | null = null;
let loadPromise: Promise<KeyringSnapshot> | null = null;
let tableEnsurePromise: Promise<boolean> | null = null;

function fingerprintSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 16);
}

function getKekSecret(): string {
  const secret = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be set (min 32 chars) as master KEK');
  }
  return secret;
}

function deriveKekBuffer(secret: string): Buffer {
  const salt = createHash('sha256').update(`merlin-kek-wrap:${secret}`).digest('hex');
  return scryptSync(secret, salt, 32);
}

/** Wrap a DEK secret with the env KEK (not the DEK path — avoids recursion). */
export function wrapDekSecret(plaintextSecret: string): string {
  const key = deriveKekBuffer(getKekSecret());
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function unwrapDekSecret(wrapped: string): string {
  const key = deriveKekBuffer(getKekSecret());
  const data = Buffer.from(wrapped, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = data.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function generateDekSecret(): string {
  return randomBytes(48).toString('base64url');
}

export function fingerprintDek(secret: string): string {
  return fingerprintSecret(secret);
}

function isMissingTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return (
    /EncryptionKeyring/i.test(msg) &&
    (/does not exist/i.test(msg) ||
      /no such table/i.test(msg) ||
      /P2021/i.test(msg) ||
      /SQLITE_ERROR/i.test(msg))
  ) || /no such table:\s*EncryptionKeyring/i.test(msg);
}

/**
 * Create EncryptionKeyring if missing (self-heal when D1 migration not yet applied).
 * Idempotent. Returns true when table is usable.
 */
export async function ensureEncryptionKeyringTable(): Promise<boolean> {
  if (tableEnsurePromise) return tableEnsurePromise;

  tableEnsurePromise = (async () => {
    try {
      await withRlsBypass(async () => {
        const db = getRlsDb() as {
          $executeRawUnsafe: (sql: string) => Promise<unknown>;
        };
        await db.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "EncryptionKeyring" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "primaryFingerprint" TEXT NOT NULL DEFAULT '',
    "primaryWrapped" TEXT NOT NULL DEFAULT '',
    "previousFingerprint" TEXT NOT NULL DEFAULT '',
    "previousWrapped" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastRotatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
        await db.$executeRawUnsafe(`
INSERT OR IGNORE INTO "EncryptionKeyring" (
  "id", "primaryFingerprint", "primaryWrapped",
  "previousFingerprint", "previousWrapped", "version", "createdAt", "updatedAt"
) VALUES (
  'global', '', '', '', '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)`);
      });
      // Prove Prisma can read it
      await withRlsBypass(async () => {
        await getRlsDb().encryptionKeyring.findUnique({ where: { id: KEYRING_ID } });
      });
      logger.info('encryption.keyring_table_ensured');
      return true;
    } catch (error) {
      logger.error('encryption.keyring_table_ensure_failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      tableEnsurePromise = null;
      return false;
    }
  })();

  return tableEnsurePromise;
}

function bootstrapFromEnv(): KeyringSnapshot {
  const primary = getKekSecret();
  const prev = process.env.DATA_ENCRYPTION_KEY_PREVIOUS?.trim();
  const previousSecret = prev && prev.length >= 32 && prev !== primary ? prev : null;
  return {
    primarySecret: primary,
    previousSecret,
    primaryFingerprint: fingerprintSecret(primary),
    previousFingerprint: previousSecret ? fingerprintSecret(previousSecret) : null,
    version: 0,
    lastRotatedAt: null,
    inAppActive: false,
    dualKeyActive: Boolean(previousSecret),
  };
}

function setCache(snap: KeyringSnapshot): KeyringSnapshot {
  cache = { ...snap, loadedAt: Date.now() };
  return snap;
}

/** Invalidate cache after rotation writes. */
export function invalidateKeyringCache(): void {
  cache = null;
  loadPromise = null;
}

/**
 * Load keyring into process memory. Safe to call often (deduped).
 * Falls back to env DATA_ENCRYPTION_KEY when no in-app DEK is stored yet.
 */
export async function ensureEncryptionKeyringLoaded(force = false): Promise<KeyringSnapshot> {
  if (!force && cache && Date.now() - cache.loadedAt < 30_000) {
    return cache;
  }
  if (!force && loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const row = await withRlsBypass(async () =>
        getRlsDb().encryptionKeyring.findUnique({ where: { id: KEYRING_ID } })
      );
      if (row?.primaryWrapped?.trim()) {
        const primarySecret = unwrapDekSecret(row.primaryWrapped);
        let previousSecret: string | null = null;
        if (row.previousWrapped?.trim()) {
          try {
            previousSecret = unwrapDekSecret(row.previousWrapped);
          } catch (error) {
            logger.error('encryption.keyring_previous_unwrap_failed', {
              error: error instanceof Error ? error.message : 'unknown',
            });
          }
        }
        return setCache({
          primarySecret,
          previousSecret,
          primaryFingerprint: row.primaryFingerprint || fingerprintSecret(primarySecret),
          previousFingerprint:
            row.previousFingerprint ||
            (previousSecret ? fingerprintSecret(previousSecret) : null),
          version: row.version,
          lastRotatedAt: row.lastRotatedAt?.toISOString() ?? null,
          inAppActive: true,
          dualKeyActive: Boolean(previousSecret),
        });
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        logger.info('encryption.keyring_table_missing_bootstrap', {
          detail: 'EncryptionKeyring missing — using env KEK until table is created',
        });
        // Best-effort create so the next rotate can succeed without a deploy wait.
        await ensureEncryptionKeyringTable();
      } else {
        logger.error('encryption.keyring_load_failed', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    return setCache(bootstrapFromEnv());
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

/** Sync read of cached keyring — must call ensureEncryptionKeyringLoaded first on hot path. */
export function getCachedKeyring(): KeyringSnapshot {
  return cache || bootstrapFromEnv();
}

/**
 * One-click in-app rotation:
 * 1. new DEK becomes primary (wrapped in DB)
 * 2. current primary becomes previous
 * 3. cache refreshed — encrypt uses new DEK immediately; decrypt still opens old
 */
export async function rotateInAppDek(): Promise<{
  primaryFingerprint: string;
  previousFingerprint: string;
  version: number;
}> {
  const tableOk = await ensureEncryptionKeyringTable();
  if (!tableOk) {
    throw new Error(
      'EncryptionKeyring table could not be created. Apply D1 migration: npx wrangler d1 migrations apply merlinus-d1 --remote'
    );
  }

  const current = await ensureEncryptionKeyringLoaded(true);
  const previousSecret = current.primarySecret;
  const newSecret = generateDekSecret();
  const primaryFingerprint = fingerprintSecret(newSecret);
  const previousFingerprint = fingerprintSecret(previousSecret);
  const primaryWrapped = wrapDekSecret(newSecret);
  const previousWrapped = wrapDekSecret(previousSecret);
  const now = new Date();

  try {
    await withRlsBypass(async () => {
      const db = getRlsDb();
      const existing = await db.encryptionKeyring.findUnique({ where: { id: KEYRING_ID } });
      const version = (existing?.version ?? 0) + 1;
      await db.encryptionKeyring.upsert({
        where: { id: KEYRING_ID },
        create: {
          id: KEYRING_ID,
          primaryFingerprint,
          primaryWrapped,
          previousFingerprint,
          previousWrapped,
          version,
          lastRotatedAt: now,
        },
        update: {
          primaryFingerprint,
          primaryWrapped,
          previousFingerprint,
          previousWrapped,
          version,
          lastRotatedAt: now,
          updatedAt: now,
        },
      });
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      throw new Error(
        'EncryptionKeyring table is missing. Run: npx wrangler d1 migrations apply merlinus-d1 --remote (migration 20250801120000_encryption_keyring)'
      );
    }
    throw error;
  }

  invalidateKeyringCache();
  await ensureEncryptionKeyringLoaded(true);

  logger.info('encryption.keyring_rotated', {
    primaryFingerprint,
    previousFingerprint,
  });

  return {
    primaryFingerprint,
    previousFingerprint,
    version: getCachedKeyring().version,
  };
}

/** After re-encrypt completes — drop previous DEK so dual-key window closes. */
export async function finalizeInAppDekRotation(): Promise<void> {
  await ensureEncryptionKeyringTable();
  try {
    await withRlsBypass(async () => {
      const db = getRlsDb();
      const row = await db.encryptionKeyring.findUnique({ where: { id: KEYRING_ID } });
      if (!row?.primaryWrapped) return;
      await db.encryptionKeyring.update({
        where: { id: KEYRING_ID },
        data: {
          previousFingerprint: '',
          previousWrapped: '',
          updatedAt: new Date(),
        },
      });
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      throw new Error(
        'EncryptionKeyring table is missing. Apply migration 20250801120000_encryption_keyring on D1 remote.'
      );
    }
    throw error;
  }
  invalidateKeyringCache();
  await ensureEncryptionKeyringLoaded(true);
  logger.info('encryption.keyring_finalized', {
    primaryFingerprint: getCachedKeyring().primaryFingerprint,
  });
}
