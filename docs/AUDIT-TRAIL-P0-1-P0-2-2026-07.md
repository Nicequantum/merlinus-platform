# Audit trail — close P0-1 Encryption Completeness + P0-2 Documentation Honesty

**Date:** 2026-07-22  
**Product:** Merlinus Apex **v4.1.0**  
**Triggers:** Enterprise due-diligence audit (national multi-rooftop Conditional GO)

---

## P0-1 — Encryption rotation completeness

| Change | Path / detail |
|--------|----------------|
| Full AES inventory | `src/lib/encryption/reencryptPlan.ts` — **23 tables / 54 columns** |
| MFA covered | `userMfa.secretEncrypted`, `backupCodesEncrypted`; `technician.mfaSecretEncrypted`, `mfaBackupCodesEncrypted` |
| Runtime walk | `src/lib/encryption/rotationService.ts` uses plan for batch reencrypt + dynamic `estimateTotalRecords` |
| Dual-key safety | Unchanged encrypt-with-primary / decrypt-with-candidates; reencrypt uses dual-key decrypt then primary encrypt |
| Primary-only probe helpers | `canDecryptWithPrimaryKeyOnly`, `requiresPreviousKeyToDecrypt` in `encryption.ts` |
| MFA stale probe | `probeStaleMfaCiphertext()` — health + rotation status bundle |
| Health warn | `checkEncryption()` warns if MFA ciphertext still on previous key |
| UI | `EncryptionRotationPanel.tsx` shows full coverage + MFA probe |
| API types | `src/lib/api.ts` `coverage` + `mfaStaleProbe` |
| Tests | `tests/unit/encryptionRotation.test.ts` — schema vs plan completeness + MFA + dual-key stale detection |
| Runbook | `docs/Reencryption-Runbook.md` updated |

**Zero-downtime:** `DATA_ENCRYPTION_KEY_PREVIOUS` remains required until reencrypt finishes **and** MFA probe is clean.

---

## P0-2 — Documentation honesty

| Change | Path / detail |
|--------|----------------|
| Fortress rewrite | `docs/Security-Fortress.md` — **Application-layer RLS on D1 with registry + Prisma extension. Not true DB RLS.** |
| Risk acceptance | `docs/Multi-Tenant-Isolation.md` — legal/compliance sign-off table |
| Docs index | `docs/README.md` v4.1.0 language |
| Production checklist | `docs/Production-Readiness-Checklist.md` — 2.5b2 tenancy honesty; 2.5i full reencrypt+MFA |
| Modular OS diagram | `docs/Modular-OS-Overview.md` — D1 app-layer tenancy (not Postgres+RLS) |
| ASVS notes | `docs/ASVS-L2-L3-SOURCE-CODE-AUDIT-REPORT.md` §8 closed items |
| Pre-rollout gate | `scripts/pre-rollout-validation.ts` → `checkTenancyDocumentationHonesty()` |

---

## Verification performed

- Unit: `encryptionRotation.test.ts` + `settingsSecurityPolish.test.ts` + p3/lowPriority suites — pass  
- Coverage summary: `includesMfa: true`, planVersion `v4.1.0-full-aes`  
- Pre-rollout: P0-1/P0-2 section expected green (see CI / `npm run validate:pre-rollout`)

---

## Residual (not in this change)

- Single platform DEK (not per-rooftop KMS)  
- App-layer tenancy residual risk (accepted via diligence packet, not eliminated)  
- Independent pen-test still required for national rollout  
