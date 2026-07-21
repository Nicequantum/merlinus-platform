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

### Procedure

1. **Maintenance window** — set `MERLIN_MAINTENANCE_MODE=true` so technicians cannot trigger heavy writes.
2. **Backup** — full database snapshot before any key change.
3. **Plaintext sweep** — `npm run db:reencrypt` with the **current** keys (expect `updated: 0` on second run).
4. **Activate dual-key**  
   - Set `DATA_ENCRYPTION_KEY_PREVIOUS` = old key  
   - Set `DATA_ENCRYPTION_KEY` = new key  
   - Deploy Worker secrets and restart.
5. **Re-encrypt under dual-key** — run `npm run db:reencrypt` (and any custom table walk using `reencryptCiphertextWithCurrentKey`) so rows are rewritten with the new primary key. When `SEARCH_HMAC_KEY` also changes, regenerate `roNumberSearchTokens` for every repair order.
6. **Verify** — `npm run validate:pre-rollout`, spot-check RO detail + list search, confirm no `piiDecryptWarnings`.
7. **Close dual-key** — delete `DATA_ENCRYPTION_KEY_PREVIOUS` from Worker secrets; redeploy.
8. **Clear maintenance** — unset `MERLIN_MAINTENANCE_MODE` only after validation passes.