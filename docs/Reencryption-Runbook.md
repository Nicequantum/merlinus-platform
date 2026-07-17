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

## Key rotation (L4)

Rotating `DATA_ENCRYPTION_KEY` or `SEARCH_HMAC_KEY` requires decrypting every row with the **old** key and re-encrypting with the **new** key. `npm run db:reencrypt` covers **plaintext-to-encrypted** backfill only — run it first so no legacy plaintext remains before a rotation event.

1. **Maintenance window** — set `MERLIN_MAINTENANCE_MODE=true` so technicians cannot trigger new writes.
2. **Backup** — full database snapshot before any key change.
3. **Plaintext sweep** — `npm run db:reencrypt` with the current keys (expect `updated: 0` on second run).
4. **Dual-key pass** — coordinate with platform maintainer for a one-time rotation script that reads ciphertext with the retired key and writes with the new `DATA_ENCRYPTION_KEY` / `SEARCH_HMAC_KEY`. When `SEARCH_HMAC_KEY` changes, `roNumberSearchTokens` must be regenerated for every repair order.
5. **Verify** — `npm run validate:pre-rollout`, spot-check RO detail + list search, confirm no `piiDecryptWarnings` on known-good rows.
6. **Clear maintenance** — unset `MERLIN_MAINTENANCE_MODE` only after validation passes.