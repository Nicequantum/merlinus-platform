# Changelog

All notable changes to Merlinus are documented here.

## [4.1.0] — 2026-07-22 (national multi-rooftop readiness package)

### Enterprise Fortress + Luxury Experience + Diligence Packet

Production release on top of Modular OS 4.0, finalized as the **v4.1.0 national readiness package**: P0 hardening closed, durable Async AI with **critical** queue health, MFA fortress, CSRF full mutating-route enforcement, bay/desktop polish, multi-department Sophia + Personal Tailoring, Manager Control Center, zero-downtime dual-key encryption with **full AES reencrypt including MFA**, documentation honesty (app-layer D1 tenancy), and buyer risk acceptance forms.

| Area | Summary |
|------|---------|
| **Encryption rotation (P0-1)** | Dual-key + `reencryptPlan.ts` full inventory (UserMfa + Technician MFA mirrors + all `*Encrypted`); MFA stale probe; health warn; [Reencryption-Runbook](docs/Reencryption-Runbook.md) |
| **Docs honesty (P0-2)** | Security-Fortress / Multi-Tenant state **application-layer RLS on D1, not true DB RLS**; pre-rollout overclaim scan |
| **AI queue (P0-4)** | Unbound/backlog/error/age/probe → **error** status; `/api/health` 503 when critical; Control Center `queueSignal` + operator guidance |
| **CSRF (P1)** | Double-submit `merlin_csrf` + `X-Merlin-CSRF` on mutating APIs; middleware seed; bare auth routes enforce |
| **RLS registry gate (P0-3)** | Hard `check:rls-registry` in CI + pre-deploy; PR template requires registration |
| **MFA fortress** | TOTP + backup codes; **`MERLIN_MFA_ENFORCE=true` production recommendation** for national GO |
| **Async AI + SSE** | Durable AiJob + CF Queue consumer; job SSE; Manager Job Monitor |
| **Voice multi-dept** | Sophia Service / Loaner / Parts / Sales + Personal Tailoring |
| **Manager Control Center** | Overview / Jobs / Voice / Modules / Health + live SSE + queue criticality |
| **Companion residual** | Last-write-wins concurrent edits documented; dirty snapshot pause |
| **Gates** | API default-deny; RLS registry; unit suite green; `ready-to-deploy` code gate |
| **Diligence packet** | [Production-Readiness-Checklist](docs/Production-Readiness-Checklist.md) SSoT · [Buyer-Risk-Acceptance-Summary](docs/Buyer-Risk-Acceptance-Summary.md) · Security-Fortress · Multi-Tenant-Isolation · Master-Rollout |

**Ops (live Worker — not code):** secrets (KV, D1, R2, Grok, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`); remove seed passwords; bind AI queues + deploy consumer (`APP_BASE_URL`, `AI_QUEUE_CONSUMER_SECRET`); enroll managers then `MERLIN_MFA_ENFORCE=true`; apply D1 migrations; leave `DATA_ENCRYPTION_KEY_PREVIOUS` unset except during rotation; sign Production-Readiness + buyer risk acceptance. Recommend key rotation every **90 days**.

## [4.0.0] — 2026-07-17

### Modular Dealership OS — feature-complete (CDK live sync deferred)

Major product release: Merlinus expands from warranty narrative into a **modular dealership operating system**. Core RO → evidence → AI story remains **always on** and is never a toggleable product module.

**Handover / start here:** [docs/Modular-OS-Overview.md](docs/Modular-OS-Overview.md)

| Track | Summary |
|-------|---------|
| **PR-M0** | Product module entitlements (`ModuleId`, `DealershipModule` / `DealerGroupModule`, catalog, force-env break-glass) |
| **PR-M1a/M1b** | Video MPI findings, checklist, status board, chunked upload, offline queue |
| **PR-M2** | `DepartmentRequest` spine + Parts inbox, parts role |
| **PR-M3** | Maintenance tickets, kanban, maintenance role |
| **PR-M4** | Loaner fleet, assignments, loaner role |
| **PR-M5a/M5b** | AI Voice Agent (Twilio webhooks, multi-agent sales/service, transcripts, containment metrics) |
| **PR-M8** | Unified Sales/Service inboxes (shared DepartmentRequest UI), sales/service roles + modules, voice ticket module gates |
| **Polish** | Seed module defaults, manager enable/disable UI (`module.set` audit), shared disabled notices |
| **Hardening** | Module env validation, Twilio signature fail-closed in production, Sentry release/env tags, production + go-live deployment checklists |

**Deferred:** `cdk_sync` (PR-M7) — catalog reserved; live CDK Global API client needs credentials. Clipboard CDK paste for RO context remains available without this module.

**Ops:** Prefer Manager Dashboard → Modules over `MODULES_FORCE_ENABLE` in production. Deploy current `main`, migrate, seed/provision, then pilot smoke scenarios in Modular-OS-Overview §6.

## [3.0.2] — 2026-07-15

### Production reliability hardening series — **complete on `main` (`dc8f62e`)**

Full report: [docs/Hardening-Final-Report.md](docs/Hardening-Final-Report.md).

| Wave | Commit | Summary |
|------|--------|---------|
| Scan pipeline | `f5dc5b7` | OCR hard-reset, empty MIME upload, vision-downscaled diagnostics, image populate |
| P0 + P1 | `cbfe4e6` | Save merge, companion dirty pause, no POST retries, session≠timeout, slim list, xentry concurrency 2, poll backoff |
| P2 | `6c5143c` | Search abort, voice listener cleanup, cheap clone, 409 Keep mine/Use server, create Idempotency-Key |
| Final | `dc8f62e` | Line notes/story PATCH, per-RO save queues, batched PUT line writes, dead `useSession` removed, `authClient` |

**Engineering gate:** 70 automated soak tests green (2026-07-15).  
**Ops next:** Confirm Vercel staging deploy of `dc8f62e`, run bay checklist in the hardening report, then promote to production.

## [3.0.1] — 2026-07-11

### Enterprise Readiness Cleanup (Phase 7.1–7.3) — **complete**

Major maintainability and multi-tenant scale pass after the security hardening sprint. Full notes: [docs/Security-Fortress.md](docs/Security-Fortress.md).

| Phase | Summary |
|-------|---------|
| **7.1** | Prisma `getRlsDb` / `withRlsBypass` consistency; advisor metrics 90d window; owner summary SQL day buckets; batched image access; platform-operator-only national session; production weak-secret hard-fail; Zod JWT claim validation |
| **7.2** | Log/Sentry redaction; Sentry only on 5xx; rate-limit success→debug; request correlation IDs; Grok/Blob `reportMappedRouteError`; H12 behavioral tests (429, RLS contracts, session revoke, Clerk webhook) |
| **7.3** | Per-dealership IANA timezone + day-boundary/usage; `withStoryAiRoute` + `blockServiceAdvisorAi`; multi-group portfolio switcher; hot-path composite indexes |

**Status:** Engineering delivery for Phases **7.1–7.3 is complete.** Apply migration `20250716120000_apex_phase7_3_timezone_indexes` on production Supabase with Phase 6 RLS migrations + production KV.

### Security Hardening Sprint (Phase 6.1–6.5) — **complete and production-ready**

Enterprise multi-dealership security pass after third-party-style audit. **Code baseline for Phases 6.1–6.5 is complete and production-ready.** Full notes: [docs/Security-Fortress.md](docs/Security-Fortress.md).

| Phase | Summary |
|-------|---------|
| **6.1** | Remove hard-coded owner secrets; create-only owner seed (no password overwrite); admin reset forces `mustChangePassword`; re-validate `ownerMayEnterDealership` on session rebuild; explicit platform operator allowlist (`APEX_PLATFORM_OWNER_EMAILS`) |
| **6.2** | Apex RLS default-deny (`app.rls_soft_open`); Technician / UsageLog / DealerGroupMembership RLS; control-plane `withRlsBypass`; Grok proxy short-lived HMAC tokens + timing-safe verify |
| **6.3** | Manager/admin auto dealership context + `getRlsDb`; allowlist-only audit metadata + `roNumberHash`; fail-closed `ro.list`; companion rate limits; production auth KV fallback warnings |
| **6.4** | Production KV setup docs + boot readiness logs; MFA/SSO + pen-test roadmap; pre-rollout complete gates |
| **6.5** | Apex production **fail-closed** without KV (503); MFA/SSO **implementation guidance**; final pre-rollout gates (no hard-coded credentials, RLS default-deny) |

**Migration note:** Phase 6.2 RLS policy on `DealerGroupMembership` must reference Postgres column `"technician_id"` (not camelCase `"technicianId"`) — corrected in `20250715120000_apex_phase6_2_rls_default_deny`.

**Production readiness:** ship with Vercel KV on Apex production, RLS + Phase 7.3 migrations applied, and pre-rollout **APEX 6.1–6.5** green.  
**Follow-on (product / ops, not code blockers):** deliver MFA/SSO features; independent pen test after production deploy.

### DealerGroup & group owner dashboard

- **PR-G1** — `DealerGroup` / `DealerGroupMembership` schema, VITI-AUTO seed, James Gray username owner (`viti.james.gray`).
- **PR-G2** — `scopeMode: group`, membership-filtered dealership list, enter/exit home session.
- **PR-G3** — Tier 1 portfolio metrics + rooftop comparison cards.
- **PR-G4** — Tier 2 trends (sparklines), certification rate, time-to-certify, AI usage, login health, staff depth.
- **PR-G5** — Tier 3 categorized attention flags, UX polish, `docs/Apex-DealerGroup-Owner-Dashboard.md`, pre-rollout **APEX DealerGroup** gate.
- Unit tests updated for group scope enums, owner username login, owner home routing, and group-scoped dealership API.

### Secure dealer provisioning (Apex multi-rooftop)

- **PR-P1** — `provisionDealer()` engine, CLI (`npm run provision-dealer`), templates, `must_change_password` migration, PII-free `dealer.provision` audit.
- **PR-P2** — Operator docs (`docs/Apex-Dealer-Onboarding.md`), forced password change UI gate.
- **PR-P3** — Opt-in `POST /api/owner/provision-dealer` behind `APEX_ALLOW_HTTP_PROVISION=true`.
- **PR-P4** — Integration tests (CLI + HTTP + password gate), `npm run smoke:dealer-provision`, pre-rollout **APEX Dealer Provision** gate.

### Security fortress & Apex platform (prior 3.0.x)

- Phase 6.0 Security Fortress complete (RLS, fail-closed audits, session revocation).
- Owner national scope + multi-rooftop login fixes for Apex mode.

---

## [3.0.0] — 2026-07-02

### Shop-floor release

- **Prompt v3.0.0** — veteran master-technician personas, anti-robotic tone, full 10-step warranty workflow (`THREE_C_GENERATION_RULES` + `SYSTEM_PROMPT`).
- **Diagnostic photos** — auto-save, preview, and delete for RO scan and Xentry diagnostic evidence.
- **Audit Story** — extended Grok scoring timeout (90s), route `maxDuration` 100s, stale-story toast on workflow errors.
- **Xentry cancel UX (L5)** — `cancelProcessing` clears pending diagnostic photo queue again.
- **Rebrand** — repository canonical URL `Nicequantum/Merlinus`; seed password no longer documented in README.
- **ESLint** — zero warnings: Next.js `Image` for photo grids; intentional hook-deps documented.

---

## [2.1.0] — 2026-07-02

### Pre-validation polish

- Updated **Technician Quick Start** and **Bay Reference Card** to match current UI labels (`Generate MI 4.3`, `Diagnostic Evidence`, `Audit Story`, certification flow).
- Added SVG wireframe screenshots in `docs/images/` for print-ready technician documentation.
- Pre-rollout validation now **separates code failures from configuration/env failures** in the summary report.
- Documented **Phase 1 accepted risks** (SSO/MFA, encryption key rotation) with compensating controls in source code.
- Expanded README with **Vercel KV setup** instructions for production rate limiting.
- Removed deprecated `filteredROs` export; public `/api/status` no longer exposes AI configuration.
- Xentry cancel clears pending diagnostic photo queue (parity with RO scan cancel).
- Low-priority audit items L1–L5 verified with unit tests and pre-rollout checks.

### Security & audit (from hardening cycle)

- Vision pipeline mutex, Xentry cancel/abort, diagnostics extract audit trail.
- PII tolerant reads with `piiDecryptWarnings` and client toast feedback.
- Xentry data model separation (RO vs line), audit metadata display in `AuditLogView`.
- `withAuth` uses session compliance versions without extra DB lookups.

---

## [2.0.0] — 2026

Enterprise security hardening release: AES-256-GCM PII encryption, hash-chained audit trail, CSP headers, Customer Pay templates, voice input for shop-floor tablets, and full rollout documentation suite.

