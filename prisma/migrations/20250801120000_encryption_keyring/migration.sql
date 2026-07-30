-- In-app DEK keyring (wrapped by DATA_ENCRYPTION_KEY as KEK)
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
);

INSERT OR IGNORE INTO "EncryptionKeyring" ("id", "primaryFingerprint", "primaryWrapped", "previousFingerprint", "previousWrapped", "version", "createdAt", "updatedAt")
VALUES ('global', '', '', '', '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
