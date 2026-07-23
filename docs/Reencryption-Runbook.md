# Merlinus Re-encryption Runbook

**Version:** 4.1.0 · **Updated:** 2026-07-22  

**M30 / L4 / P0-1:** Post-deploy workflow for legacy plaintext migration and **dual-key AES-256-GCM rotation** with **full column inventory** (including MFA secrets).

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
3. **Generate key (UI)** — Settings → **Security** → Encryption key rotation → **Generate new key**  
   - Copy the one-time **newKey** (not stored in D1). Fingerprints compare live vs target.
4. **Activate dual-key secrets**  
   - `DATA_ENCRYPTION_KEY_PREVIOUS` = **old** key  
   - `DATA_ENCRYPTION_KEY` = **newKey**  
   - Deploy Worker secrets and restart.
5. **Submit New Key (UI)** — paste into **Enter newly rotated key** → **Submit New Key**  
   - Verifies fingerprint vs rotation target and live primary under dual-key.  
   - Optionally auto-starts re-encryption.
6. **Re-encryption progress** — same page progress bar (`EncryptionRotation`).  
   - Walks **all** AES `*Encrypted` columns including **UserMfa** + **Technician MFA mirrors** (`REENCRYPT_TABLE_PLAN` / `reencryptPlan.ts`).  
   - Manual **Start re-encryption** if auto-start was off. CLI: `npm run db:reencrypt` (legacy plaintext path; prefer in-app for dual-key).
7. **Verify** — spot-check RO detail + list search; **MFA login** still works; health `encryption` has no “MFA ciphertext still on previous key”; UI MFA probe clean.
8. **Close dual-key** — only after step 7: delete `DATA_ENCRYPTION_KEY_PREVIOUS` from Worker secrets; redeploy. Health should clear dual-key warn.

**Zero-downtime:** Keep PREVIOUS set until reencrypt completes. Decrypt uses dual-key candidates throughout; encrypt always uses the new primary.
9. **Clear maintenance** if used. Recommend rotation every **90 days**.

### API skeleton

| Method | Body | Purpose |
|--------|------|---------|
| `GET /api/manager/encryption/rotate` | — | Fingerprints + rotation progress |
| `POST` | `{ "action": "begin" }` | Generate new key (one-time response) |
| `POST` | `{ "action": "confirm-env", "newKey": "…" }` | Verify pasted key vs live dual-key; optional auto re-encrypt |
| `POST` | `{ "action": "start-reencrypt" }` | Background re-encrypt under dual-key |
| `POST` | `{ "action": "cancel" }` | Cancel pending/running rotation |

Manager/owner only · dealership context · audited (`encryption.rotation_*`).