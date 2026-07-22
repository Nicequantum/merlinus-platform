# Merlin Re-encryption Runbook

**M30:** Post-deploy workflow for migrating legacy plaintext database fields to AES-256-GCM encryption.

## When to run

- After deploying a build that adds new encrypted columns (`roNumberEncrypted`, `descriptionEncrypted`, etc.)
- After restoring a database backup that contains legacy plaintext sensitive fields
- For `DATA_ENCRYPTION_KEY` / `SEARCH_HMAC_KEY` rotation — see **Key rotation** below (L4)

## Prerequisites

1. `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, and `SEARCH_HMAC_KEY` set in the environment (same keys used for normal app operation)
2. Maintenance window or low-traffic period for large databases
3. Database backup completed and verified

## Commands

```bash
# Optional: tune batch size for memory (default 100)
export REENCRYPT_BATCH_SIZE=50

npm run db:reencrypt
```

## What the script does

- Processes tables in batches (`repairOrder`, `repairLine`, `advisorComplaintObservation`, `template`, `knowledgeBase`)
- Skips rows already encrypted (idempotent — safe to re-run)
- Logs `{ table, scanned, updated }` per table

## Verification

1. Spot-check a repair order in the app — VIN, customer name, and stories display correctly
2. Run `npm run validate:pre-rollout` — encryption round-trip check must pass
3. Review script output: `updated` should trend to `0` on second run

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `encryption.decrypt_failed` in logs | Row encrypted with a different key — restore backup or contact support |
| Script OOM / slow | Lower `REENCRYPT_BATCH_SIZE` to 25–50 |
| Partial completion | Re-run `npm run db:reencrypt` — only unmigrated rows are updated |

## Rollback

Restore the pre-migration database backup. Do not change encryption keys without a planned rotation.

## Key rotation (L4 / P1-5 dual-key)

Rotating `DATA_ENCRYPTION_KEY` uses an **online dual-key window** so the app can decrypt old and new ciphertext during migration.

### Dual-key encrypt/decrypt (runtime)

| Env | Role |
|-----|------|
| `DATA_ENCRYPTION_KEY` | **Current** — all new encrypts |
| `DATA_ENCRYPTION_KEY_PREVIOUS` | **Previous** — decrypt only during rotation (min 32 chars) |
| `ENCRYPTION_SALT` | Optional explicit salt (otherwise derived from current key) |

Decrypt order: current key → previous key → legacy scrypt salt variants.

### Procedure (Manager Control / in-app preferred)

1. **Backup** — full database snapshot before any key change.
2. **Optional maintenance** — `MERLIN_MAINTENANCE_MODE=true` for large fleets (not strictly required for dual-key online window).
3. **Begin rotation (UI)** — Settings → Encryption key rotation → **Begin rotation**  
   - Copy the one-time **newKey** (not stored in D1).  
   - Fingerprints shown for primary/previous (never the raw key).
4. **Activate dual-key secrets**  
   - `DATA_ENCRYPTION_KEY_PREVIOUS` = **old** key  
   - `DATA_ENCRYPTION_KEY` = **newKey**  
   - Deploy Worker secrets and restart.
5. **Start re-encryption (UI)** — **Start re-encryption** runs a background table walk (`EncryptionRotation` progress %).  
   - CLI alternative: `npm run db:reencrypt` with dual-key env still set.
6. **Verify** — `npm run validate:pre-rollout`, spot-check RO detail + list search, health `encryption` status.
7. **Close dual-key** — delete `DATA_ENCRYPTION_KEY_PREVIOUS` from Worker secrets; redeploy. Health should clear dual-key warn.
8. **Clear maintenance** if used. Recommend rotation every **90 days**.

### API skeleton

| Method | Body | Purpose |
|--------|------|---------|
| `GET /api/manager/encryption/rotate` | — | Fingerprints + rotation progress |
| `POST` | `{ "action": "begin" }` | Generate new key (one-time response) |
| `POST` | `{ "action": "start-reencrypt" }` | Background re-encrypt under dual-key |
| `POST` | `{ "action": "cancel" }` | Cancel pending/running rotation |

Manager/owner only · dealership context · audited (`encryption.rotation_*`).