# Buyer Risk Acceptance Summary — Merlinus Apex v4.1.0

**Document type:** Enterprise diligence / multi-rooftop licensing  
**Product version:** 4.1.0  
**Updated:** 2026-07-22  
**Audience:** Dealer-group CISO, legal/compliance, Fixed Ops director, vendor security owner  

This one-page summary is the **signable residual-risk packet**. Technical detail lives in:

- [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) — go-live SSoT  
- [Multi-Tenant-Isolation.md](./Multi-Tenant-Isolation.md) — tenancy model  
- [Security-Fortress.md](./Security-Fortress.md) — controls inventory  
- [Reencryption-Runbook.md](./Reencryption-Runbook.md) — key rotation  

---

## What you are buying (accurate claims)

| Claim | Accurate description |
|-------|----------------------|
| Multi-tenant isolation | **Application-layer RLS on Cloudflare D1** via ALS + Prisma extension + model registry + CI. **Not** Postgres / database-enforced RLS. |
| Encryption | AES-256-GCM field encryption; dual-key rotation window; reencrypt covers **all** AES columns **including MFA secrets**. Platform-wide data encryption key (not per-rooftop KMS). |
| Auth | Session + optional Apex refresh; TOTP MFA; CSRF double-submit (`merlin_csrf` + `X-Merlin-CSRF`); Apex fail-closed rate limits without KV. |
| Async AI | Durable AiJob + CF Queues; **critical** health when queue unbound/backlogged/failing; inline fallback may still serve some bay work. |
| Ops UI | Manager Control Center + bay tablet + Desktop Command Center live sync. |

**Do not market or contract as:** “database RLS fortress,” “Postgres RLS,” or “DB-enforced multi-tenant isolation” on the current D1 architecture.

---

## Residual risks accepted by signatories

| ID | Risk | Severity | Compensating controls | Buyer acceptance |
|----|------|----------|----------------------|------------------|
| **R1** | App-layer tenancy: a code defect or `withRlsBypass` misuse can cross rooftops; D1 credential holders see all rows | High (multi-tenant SaaS) | Registry CI gate, API wrappers, session scope, audits, pen-test recommendation | ☐ Accept |
| **R2** | Single platform DEK — one secret compromise decrypts all rooftop field ciphertext | High | Dual-key rotation, full reencrypt (incl. MFA), Worker secret hygiene | ☐ Accept |
| **R3** | Companion concurrent edit is **last-write-wins** (no OT/CRDT) | Medium (ops) | Dirty snapshot pause; process training | ☐ Accept |
| **R4** | AI queue failure can be partially masked by inline fallback | Medium | Critical health + Control Center `queueSignal`; on-call | ☐ Accept |
| **R5** | Distributed rate limits are not fully atomic under multi-isolate flood | Medium | KV required; auth fail-closed without KV | ☐ Accept |
| **R6** | Independent external pen-test / red-team not substituted by this packet | Process | Buyer-commissioned test before acquisition close | ☐ Accept / schedule |

---

## Production obligations (vendor + customer ops)

1. Complete [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) §0–§9.  
2. Set **`MERLIN_MFA_ENFORCE=true`** after elevated-role enrollment.  
3. Keep AI queue producer + consumer healthy (not critical).  
4. Never leave `DATA_ENCRYPTION_KEY_PREVIOUS` set after MFA-clean reencrypt.  
5. Protect Cloudflare account, D1, KV, and encryption secrets as crown jewels.  
6. Train staff on companion LWW and dual-device RO editing.

---

## Verdict language (recommended)

| Use case | Recommended posture |
|----------|---------------------|
| Single-rooftop pilot | **GO** after checklist criticals + MFA path |
| Multi-rooftop national | **Conditional GO** after this form + checklist + queue green + MFA enforce |
| Acquisition / exclusive license as “DB RLS fortress” | **NO-GO** unless architecture migrates or marketing corrected |

---

## Signatures

| Role | Name | Title | Signature | Date | Accept residuals R1–R6 as marked |
|------|------|-------|-----------|------|----------------------------------|
| Customer CISO / security owner | | | | | ☐ Yes |
| Customer legal / compliance | | | | | ☐ Yes |
| Fixed Ops director (ops impact understood) | | | | | ☐ Yes |
| Vendor security / platform owner | | | | | ☐ Yes |

**Dealership group / entity:** ________________________________  

**Production URL / environment:** ________________________________  

**App version locked:** 4.1.0  

**Notes / conditions:**  

_______________________________________________________________  
_______________________________________________________________  
