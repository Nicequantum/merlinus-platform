# Merlinus Production Pilot Safety Audit

**Date:** 2026-08-01  
**Repo HEAD at audit:** post-polish commit on `main`  
**Product:** Merlinus / Apex v4.1.x  
**Scope:** First Mercedes-Benz rooftop pilot readiness (not full national enterprise)  
**Auditor:** Grok Build (code + automated gates; no live Worker secret access)

---

## Executive grade

| Scope | Grade | Verdict |
|-------|-------|---------|
| **Single-store Mercedes pilot** | **A−** | **GO for pilot** with ops checklist below |
| **Multi-rooftop / multi-group scale** | **B+** | Hold until P1 soak + MFA enrollment complete |
| **National / hundreds of dealers** | **B−** | Roadmap work remains (load, enforce MFA, pen-test, honest tenancy docs signed) |

**One-line:** The platform is **pilot-ready** for controlled real-world use. It is **not** “auditor-perfect enterprise finished.” Core story workflow, isolation tests, API default-deny, P0 code gates, self-heal ops, billing meters, and provision readiness are in place. Remaining gaps are mostly **ops configuration, enrollment, load proof, and deferred product honesty** — not missing bay features.

---

## What was verified this pass (automated)

| Gate | Result |
|------|--------|
| `npm run verify:p0` | **PASS** — `P0_CODE_GATES_PASS` |
| `check:seed-secrets` | **PASS** |
| `check:rls-registry` | **PASS** (49 models registered) |
| `check:api-routes` | **PASS** (140 routes, 15 intentional bare) |
| `tsc` (`tsconfig.ci.json`) | **PASS** |
| Unit (self-heal, health, KV, pilot readiness, p0, matrix) | **28/28 PASS** |
| Tenant isolation (`test:isolation`) | **16/16 PASS** |
| Secret files gitignored | **PASS** (`OPS_MAINTENANCE_SECRET.txt`, `*.LOCAL.env`) |
| Wrangler `[vars]` | Non-secret pilot flags only (no private keys in toml) |

### Polish applied this session

1. **Test preload** — default `SESSION_SECRET` for CI/integration so isolation matrix does not hard-fail outside `.env.local`.
2. **Companion sync** — fixed `useCompanionSync` exhaustive-deps (`deviceId`) lint warning from last Cloudflare build.
3. **This audit document** — living pilot safety report.

---

## Architecture honesty (must stay true in sales/contracts)

| Claim | Truth |
|-------|--------|
| Multi-tenant isolation | **Application-layer on Cloudflare D1** (not Postgres RLS) |
| Core product | Warranty RO → evidence → AI story → certify → PDF/CDK copy |
| Product modules | Opt-in SKUs; default **off** for pilot unless contracted |
| Self-heal | **Recommend-only** Grok analysis; never auto-edits source |
| Billing UI | **Estimates / meters**, not invoices |
| CDK live push | Deferred / labeled — do not sell as live |

---

## Traffic-light control matrix

### Green (pilot solid)

| Area | Notes |
|------|--------|
| Core story pipeline | Primary revenue path |
| API default-deny | 140 routes wrapped / allowlisted |
| Tenant isolation tests | Cross-rooftop RO, images, generate, extract, consent |
| Seed secrets out of repo | check clean |
| P0 code gates | KV resolution path, MFA probe, bindings, attack plan |
| Capability matrix | Living route catalog generated |
| Owner pilot readiness | In-app gate before provision |
| National billing meters | Per-rooftop story / regen / SMS estimates |
| Self-heal + nightly window | Env-driven; soft flag; morning warmup path |
| Build fix | ops-cron excluded from Next typecheck |

### Yellow (acceptable for pilot; close during P1)

| Area | Risk | Action |
|------|------|--------|
| **MFA enforce** | Yellow until all managers enrolled | Enroll elevated staff → then `MERLIN_MFA_ENFORCE=true` |
| **Live Health tab** | Depends on Worker bindings + secrets at runtime | After deploy: Health green for KV/DB/R2/AI |
| **Sentry auth token** | Source maps not uploaded | Optional `SENTRY_AUTH_TOKEN` for nicer stack traces |
| **AI queue consumer** | Durable path needs companion worker | Confirm `merlinus-ai-jobs-consumer` + secret + APP_BASE_URL |
| **ops-cron** | Nightly self-heal needs separate deploy | Deploy `workers/ops-cron` + `APP_BASE_URL` + ops secret |
| **npm audit** | High advisories in transitive deps | Schedule non-breaking audit fix after pilot week-1 |
| **Prisma preview warning** | driverAdapters deprecation noise | Plan Prisma 7 migration off critical path |
| **ESLint residual** | Minor hooks/a11y noise elsewhere | Clean in P5 auditor pass |

### Red / deferred (do not treat as done)

| Area | Status |
|------|--------|
| Postgres/database RLS | **Not** the production path — app-layer only |
| CDK bi-directional live sync | Deferred by design |
| Full multi-rooftop load soak | Not proven until real multi-tech pilot data |
| Third-party pen-test | Not run |
| `MERLIN_MFA_ENFORCE` production-wide | Hold until enrollment complete |

---

## Pre-pilot deploy checklist (operator)

Do these on Cloudflare after this push lands:

1. **Deploy main Worker** from latest `main` (commit after this report).
2. Confirm **secrets** (not only `[vars]`):  
   `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_HMAC_KEY`, `GROK_API_KEY`,  
   `OPS_MAINTENANCE_SECRET`, Sentry DSN, queue consumer secret if used.
3. Confirm **bindings**: `DB`, `KV_STORE`, `APEX_R2`, `AI_JOBS_QUEUE`.
4. Open **Manager → Health** — expect KV/DB/AI not red; self-heal card shows **ON**.
5. National owner: **Run pilot readiness** → onboard pilot rooftop only if green/amber acceptable.
6. Optional: deploy **ops-cron** for 8pm analysis + 6am warmup.
7. Run one full bay journey: login → RO → photos → generate story → certify → PDF/copy.

---

## What could still “break” under pilot (honest)

| Failure mode | Likelihood | Mitigation |
|--------------|------------|------------|
| Cold start latency first AI call | Medium | Morning warmup + owner/manager warmup routes |
| Queue consumer misconfig | Medium | Health queue metrics + inline fallback path |
| MFA yellow noise | Medium | Enroll managers; only then enforce |
| Module assumed “on” but off | Medium | Capability matrix + Settings module toggles |
| Incomplete feature mistaken for bug | Medium | Classify: module-off vs product-incomplete vs regression |
| Peak multi-tech contention | Unknown until soak | Watch Health + self-heal nightly report |

---

## Grade rationale

**A− pilot** because:

- Security skeleton is real (auth wrappers, isolation tests, seed-secret gate, encryption keys required).
- Pilot ops tooling is real (readiness gate, P0 verify, self-heal, billing meters).
- Build path for OpenNext/Cloudflare is green after ops-cron type fix.
- Residual risk is **managed and documented**, not hidden.

**Not A / not enterprise-finished** because:

- MFA not yet enforce-on.
- No pen-test / formal load proof.
- Tenancy is app-layer (must stay honest).
- Transitive dependency audit and source-map pipeline unfinished.

---

## Recommended 14-day pilot march

| Day | Focus |
|-----|--------|
| 0 | Deploy + Health green + one happy-path story |
| 1–3 | Real techs; log every “bug” as class (module/ops/regression) |
| Nightly | Self-heal report → harden only what fails |
| 4–7 | MFA enroll managers; queue stability |
| 8–10 | Billing meter sanity vs actual story counts |
| 11–14 | Multi-tech soak; only then second rooftop |

---

## Sign-off fields

| Role | Name | Date | GO / HOLD |
|------|------|------|-----------|
| Platform owner | | | |
| Pilot store lead | | | |
| On-call eng | | | |

**Residual risk acknowledgment:** Multi-tenant isolation is application-layer on D1. MFA enforce deferred until enrollment. Self-heal does not auto-patch production code.

---

*Related:* [PRODUCTION-ATTACK-PLAN.md](./PRODUCTION-ATTACK-PLAN.md) · [Self-Heal-and-Nightly-Maintenance.md](./Self-Heal-and-Nightly-Maintenance.md) · [generated/p0-deploy-verify-latest.md](./generated/p0-deploy-verify-latest.md) · [generated/CAPABILITY-MATRIX.md](./generated/CAPABILITY-MATRIX.md)


---

## Addendum 2026-08-01 — Second-facility pass

Hardened for same-owner **two rooftops** before second store go-live:

- Provision attaches facility 2 to existing owner primary **DealerGroup**
- Owner can **switch A→B** without national exit
- Staff multi-membership **switch-dealership** API
- Group portfolio filter honors `activeDealerGroupId`
- Playbook: [SECOND-FACILITY-PILOT.md](./SECOND-FACILITY-PILOT.md)

**Revised multi-rooftop (same group) grade:** **A−** for controlled 2-facility pilot (was B+ for unbounded multi-group scale).
