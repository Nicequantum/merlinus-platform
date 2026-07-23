# Security Fortress (Phase 6.0) + Hardening Sprint (6.1–6.5) + Enterprise Cleanup (7.1–7.3)

**Status:** Production controls shipped — Security Fortress + Hardening 6.1–6.5 + Enterprise Cleanup 7.1–7.3 + **v4.1.0 national readiness package** (MFA, dual-key full AES reencrypt incl. MFA, CSRF, AI queue criticality, docs honesty)  
**Code baseline:** v4.1.0 · Updated 2026-07-22  
**Audience:** Platform security, compliance, enterprise buyers, and operators  
**Default product mode:** Merlinus single-dealer remains the safe default; Apex enables multi-rooftop fortress controls.  
**Sign-off SSoT:** [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) · [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md)

---

## Buyer / legal honesty (read first)

**Application-layer RLS on D1 with registry + Prisma extension. Not true DB RLS.**

| Claim | Reality (production) |
|-------|----------------------|
| “Postgres RLS / FORCE RLS / session GUCs” | **Not** the production tenancy model. Historical Prisma SQL migrations may still exist in git for a **non-D1** path; Cloudflare **D1/SQLite has no ROW LEVEL SECURITY**. |
| Multi-tenant isolation | **Application-enforced**: `withAuth` + ALS `withSessionRls` + Prisma query rewrite (`rlsPrismaExtension.ts`) + model registry (`rlsTenantRegistry.ts`) + CI (`check:rls-registry`). |
| Isolation mode id | `application_layer_d1` (see `docs/Multi-Tenant-Isolation.md`, `src/lib/tenantIsolation.ts`) |

**Risk acceptance (legal/compliance):** Enterprise multi-tenant production on D1 means a **hostile holder of D1 credentials** (or a bug that uses `withRlsBypass` / bare Prisma outside tenant context) can access cross-rooftop data. Buyers must accept this residual risk **or** require a future Postgres+DB-RLS migration as a contractual control. Do not market this platform as “database-enforced RLS.”

See **[Multi-Tenant-Isolation.md](./Multi-Tenant-Isolation.md)** for the full risk-acceptance language and operator checklist.

---

## Goals

1. **Defense-in-depth tenancy** — Application-layer tenant predicates on every registered PII model (D1), not Postgres RLS  
2. **Fail-closed compliance audits** — sensitive reads/writes must produce durable `AuditLog` rows  
3. **Owner least-privilege** — national owners cannot see dealership PII until enter-dealership  
4. **Session kill-switch** — credential change / logout / admin actions revoke JWT + apex refresh + Clerk  
5. **Enterprise credential hygiene** — no hard-coded owner secrets; create-only seed; explicit platform operators  
6. **MFA + dual-key encryption** — TOTP for elevated roles; AES-256-GCM with dual-key rotation and **full** reencrypt inventory (including MFA secrets)

---

## Architecture (production — D1)

```
┌──────────────────┐     withAuth      ┌─────────────────────┐
│  API route       │ ───────────────►  │ requireDealership / │
│  (PII / owner)   │                   │ requireOwnerNational│
└────────┬─────────┘                   └──────────┬──────────┘
         │                                        │
         │ withSessionRls (default)               │
         ▼                                        ▼
┌──────────────────┐                   ┌─────────────────────┐
│ AsyncLocalStorage│                   │ writeAuditedAccess  │
│ RlsContext       │                   │ (fail-closed)       │
│ + dealership id  │                   └─────────────────────┘
└────────┬─────────┘
         │ getRlsDb() / rlsTransaction() / withRlsBypass()
         ▼
┌──────────────────┐
│ Prisma extension │  createRlsEnforcedClient
│ rewrites WHERE   │  registry: rlsTenantRegistry.ts
│ on tenant models │  D1 / SQLite — no DB RLS
└──────────────────┘
```

### Key modules

| Module | Role |
|--------|------|
| [`src/lib/apex/rlsContext.ts`](../src/lib/apex/rlsContext.ts) | `withSessionRls`, `getRlsDb`, `rlsTransaction`, `withRlsBypass` (ALS; `setRlsContext` is a no-op on D1) |
| [`src/lib/apex/rlsPrismaExtension.ts`](../src/lib/apex/rlsPrismaExtension.ts) | Query rewrite: inject dealership / parent relation predicates |
| [`src/lib/apex/rlsTenantRegistry.ts`](../src/lib/apex/rlsTenantRegistry.ts) | Single source of truth for tenant models |
| [`src/lib/auditedAccess.ts`](../src/lib/auditedAccess.ts) | Fail-closed `writeAuditedAccess` |
| [`src/lib/auditMetadataSanitize.ts`](../src/lib/auditMetadataSanitize.ts) | Allowlist-only metadata; `hashRoNumberForAudit` |
| [`src/lib/apex/tenantScope.ts`](../src/lib/apex/tenantScope.ts) | Dealership / national owner guards |
| [`src/lib/apex/platformOperator.ts`](../src/lib/apex/platformOperator.ts) | Explicit platform operator allowlist |
| [`src/lib/sessionRevocation.ts`](../src/lib/sessionRevocation.ts) | `revokeAllSessionsForTechnician`, scope-switch refresh drop |
| [`src/lib/encryption.ts`](../src/lib/encryption.ts) + [`reencryptPlan.ts`](../src/lib/encryption/reencryptPlan.ts) | AES-GCM dual-key + **full** reencrypt table plan (incl. MFA) |
| [`src/lib/mfa/service.ts`](../src/lib/mfa/service.ts) | TOTP enrollment / verify |
| [`src/lib/rate-limit.ts`](../src/lib/rate-limit.ts) | Distributed KV limits; Apex production fail-closed without KV |
| [`src/lib/csrf.ts`](../src/lib/csrf.ts) + [`csrfClient.ts`](../src/lib/csrfClient.ts) | Double-submit CSRF (`merlin_csrf` + `X-Merlin-CSRF`) on mutating routes; middleware seeds cookie |

### Soft-open vs enforced (Phase 6.2+)

| Mode | Soft-open | Enforced |
|------|-----------|----------|
| **Apex** | Never (default-deny without tenant match / bypass) | On by default; `RLS_ENABLED=false` ignored |
| **Merlinus** | Soft-open when not forced | `RLS_ENABLED=true` forces enforce |

- Control-plane (login, seed, national aggregates) uses `withRlsBypass`.  
- PII routes set `enforced: true` inside `withSessionRls` / `rlsTransaction`.

### Historical note (non-production)

Older migrations under `prisma/migrations/*rls*` may reference Postgres `ENABLE/FORCE ROW LEVEL SECURITY` and `app.*` GUCs. Those are **not** active controls on the Cloudflare D1 path. Do not cite them as live production isolation.

---

## Security Hardening Sprint (complete · production-ready)

| Phase | Theme | Highlights |
|-------|--------|------------|
| **6.1** | Owner credentials & session | No hard-coded owner passwords/emails; create-only seed; admin reset sets `mustChangePassword`; explicit platform operator allowlist |
| **6.2** | App-layer default-deny + Grok proxy | Apex enforce-by-default; Technician/UsageLog scoped; short-lived Grok proxy HMAC tokens |
| **6.3** | Manager parity + audit + limits | Manager/admin dealership context + `getRlsDb`; allowlist audit metadata; companion rate limits |
| **6.4** | Finalize | Production KV guidance; MFA/SSO roadmap; changelog + pre-rollout gates |
| **6.5** | Remaining items | Apex production **fail-closed** without KV; MFA delivery path; no hard-coded credentials |

**Sprint status: complete.** Ops go-live still requires production KV, D1 migrations applied, and [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) sign-off. Follow-on: independent pen test.

---

## Enterprise Readiness Cleanup (Phases 7.1–7.3) — **complete**

| Phase | Theme | Highlights |
|-------|--------|------------|
| **7.1** | Consistency & scale | Prefer `getRlsDb` / `withRlsBypass`; production weak-secret hard-fail; Zod JWT claims |
| **7.2** | Observability & test proof | Log/Sentry redaction; request correlation IDs; behavioral tests |
| **7.3** | Future-proofing | Per-dealership IANA timezone; story AI route helpers; hot-path indexes |

**Cleanup status: complete.** Optional later: coverage gates, browser E2E, Postgres+DB-RLS **only if** contractually required (large migration — see Multi-Tenant-Isolation).

---

## Encryption rotation (v4.1 P0-1)

- Dual-key online window: `DATA_ENCRYPTION_KEY` + `DATA_ENCRYPTION_KEY_PREVIOUS`.  
- Reencrypt plan covers **all** AES `*Encrypted` columns including **UserMfa** and **Technician MFA mirrors**.  
- Health warns if MFA ciphertext remains on previous key after rotation.  
- Do **not** remove PREVIOUS until reencrypt complete **and** MFA probe is clean.  
- Runbook: [Reencryption-Runbook.md](./Reencryption-Runbook.md).

---

## MFA / SSO — Phase 6.5 implementation guidance

| Capability | Status |
|------------|--------|
| **Native TOTP MFA** | Shipped — `src/lib/mfa/service.ts`, UserMfa + Technician mirrors, in-app QR/enroll, backup codes |
| **Enforce elevated roles** | **Production recommendation: `MERLIN_MFA_ENFORCE=true`** after managers enroll (required for national multi-rooftop). Without it, `mfaPolicy` health is **warn** in production. |
| **Session impact** | Enrollment revoke sessions via `revokeAllSessionsForTechnician` |
| **Clerk** | Optional identity provider path for linked accounts (`authProvider` / `clerkUserId`); fortress session still uses app JWT + refresh |
| **SSO / WebAuthn** | Roadmap — compensating controls: TOTP MFA, strong password policy, fail-closed KV rate limits, sessionVersion kill-switch |
| **Apex without KV** | **Fail closed** on auth rate limits (Phase 6.5) — do not run multi-isolate production without `KV_STORE` |

Operators: enroll managers → enable `MERLIN_MFA_ENFORCE` → include MFA columns in every key rotation (full reencrypt plan).

---

## AI jobs queue — operational criticality (P0-4)

Durable Async AI (CF Queues + `AiJob` + consumer Worker) is a **first-class production dependency**.

| Condition | Health status | Notes |
|-----------|---------------|--------|
| Producer unbound in production | **error** (critical) | Inline fallback only — not “green” |
| Depth ≥ 200 or oldest queued ≥ 45m | **error** | Consumer stall / backlog |
| 24h error rate ≥ 50% | **error** | Grok/consumer failures |
| D1 queue probe failed | **error** | Cannot observe jobs |
| Depth ≥ 50, err ≥ 25%, oldest ≥ 15m | **warn** | Elevated |
| Healthy | **ok** | — |

- Manager `/api/health` includes `services.aiJobsQueue` and top-level `aiJobsQueue.operatorGuidance`.  
- In production, **critical** queue status contributes to HTTP **503** (`getCriticalHealthServices` includes `aiJobsQueue`).  
- Manager Control Center exposes `queueSignal` (status, oldest age minutes, operator guidance) on Overview + AI Jobs banners.  
- **Residual:** some bay paths may still complete via inline fallback — operators must not treat fallback as healthy national-rollout posture.

### Companion concurrent edits (residual)

Desktop Command Center + bay tablet sync is **last-write-wins** on the same repair line (no OT/CRDT). Local dirty state on the bay **blocks** full remote snapshot clobber. Train managers/techs not to dual-edit the same line simultaneously.

---

## Owner session model

| State | Allowed | Denied |
|-------|---------|--------|
| **National / group home** | `/api/owner/*`, enter-dealership (scoped rooftops) | RO/PII routes (`DEALERSHIP_CONTEXT_REQUIRED`) |
| **Dealership** | PII routes for active rooftop | National summary / dealership list / re-enter without exit |

- Platform-wide rooftop access requires **explicit** platform operator emails.  
- Group owners only see rooftops under their `DealerGroupMembership`.  
- Enter / exit revoke prior apex refresh families before re-issue.

---

## Mandatory audit surfaces (non-exhaustive)

Sensitive PII routes should call `writeAuditedAccess` (fail-closed where configured). Owner national aggregates and provision paths must stay on intentional bypass with audit.

---

## ASVS alignment notes

- **F-01 (app-layer tenancy):** Documented and risk-accepted here + Multi-Tenant-Isolation; not remediated by DB RLS on D1.  
- MFA (former F-02 gap): TOTP implemented; enforce via `MERLIN_MFA_ENFORCE`.  
- Dual-key + full reencrypt (former F-07 partial): closed for inventory completeness; single platform DEK remains an architectural residual.  
- Full L2/L3 scores require independent re-assessment after pen-test.
