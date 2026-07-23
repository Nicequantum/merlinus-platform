# Merlinus Apex — Production Readiness Checklist

**Version:** 4.1.0 · **Prompt:** 4.1.0 · **Package:** National multi-rooftop readiness · **Updated:** 2026-07-22  

**Purpose:** **Single source of truth (SSoT)** for go-live and national multi-rooftop sign-off. Covers core RO story, Async AI, Voice multi-department + tailoring, Manager Control Center, MFA, encryption rotation, CSRF, bay tablet, Desktop Command Center, and buyer diligence honesty.

**A deployment is blocked** until:

1. All **Critical (✅)** engineering/security items are **Pass**, and  
2. Required **signatures** in §10 are recorded, and  
3. [Buyer Risk Acceptance Summary](./Buyer-Risk-Acceptance-Summary.md) is signed for multi-store / acquisition contexts.

| Related document | Use when |
|------------------|----------|
| [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md) | CISO / legal residual risk sign-off |
| [Rollout-Runbook.md](./Rollout-Runbook.md) | Multi-store sequence |
| [Master-Rollout-Document.md](./Master-Rollout-Document.md) | Leadership overview |
| [Security-Fortress.md](./Security-Fortress.md) | Controls reference (app-layer D1 tenancy) |
| [Multi-Tenant-Isolation.md](./Multi-Tenant-Isolation.md) | Tenancy model + risk acceptance template |
| [Reencryption-Runbook.md](./Reencryption-Runbook.md) | Dual-key PII / MFA reencrypt |
| [Product-Modules.md](./Product-Modules.md) | Module entitlements |

---

## GO criteria (national multi-rooftop)

| # | Criterion | Required |
|---|-----------|----------|
| G1 | Engineering gates green: `npm test`, `check:rls-registry`, `check:api-routes`, `ready-to-deploy` (0 critical **code** failures) | Yes |
| G2 | Live Worker secrets complete (§9); no `OWNER_SEED_PASSWORD*` on production | Yes |
| G3 | KV bound; Apex production fail-closed without KV verified | Yes |
| G4 | AI queue producer + consumer bound; Manager `queueSignal` / `aiJobsQueue` **not** critical | Yes |
| G5 | Managers enrolled in MFA; **`MERLIN_MFA_ENFORCE=true`** set after enrollment | Yes (production recommendation; required for national GO) |
| G6 | Tenancy honesty acknowledged — **application-layer RLS on D1, not true DB RLS** — risk acceptance signed | Yes (multi-store / group) |
| G7 | Shop-floor smoke: RO story + Control Center + companion process (LWW) trained | Yes |
| G8 | Dual-key **off** except during scheduled rotation; reencrypt plan includes MFA | Yes |

**Verdict boxes (fill at sign-off)**

| | |
|--|--|
| **GO / Conditional GO / NO-GO** | _______________ |
| **Scope** | ☐ Single rooftop pilot · ☐ Multi-rooftop group · ☐ National |
| **App version** | 4.1.0 |
| **Worker / URL** | _______________ |
| **Build commit** | _______________ |

---

## Golden rules

1. Core RO story pipeline is **always on** — never a toggleable product module.  
2. Tenancy is **application-layer on Cloudflare D1** — not Postgres/database RLS.  
3. `DATA_ENCRYPTION_KEY_PREVIOUS` is **only** set during active key rotation.  
4. Prefer Manager → Modules over `MODULES_FORCE_ENABLE` in production.  
5. **`MERLIN_MFA_ENFORCE=true`** after elevated-role TOTP enrollment (national production).  
6. Encryption key rotation recommended every **90 days** (full AES plan including MFA).  
7. AI queue **critical** health is a production incident — do not treat inline fallback as “green.”  
8. Companion concurrent edits: **last-write-wins** — one active editor per line at certification peaks.

---

## 0. Engineering gate (must exit 0 for code)

```bash
npm run ready-to-deploy   # seed secrets + RLS registry + API routes + pre-deploy + pre-rollout
npm test                  # unit (mainline must be 100% green)
npm run test:integration  # needs DB when scenarios hit live data
npm run typecheck         # optional CI parity
npm run check:rls-registry
npm run check:api-routes
```

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 0.1 | `npm run ready-to-deploy` — **0 critical code failures** (`MERLIN_DEPLOY_GATE=production` for strict env) | ✅ | ☐ | | |
| 0.2 | Unit tests pass (`npm test`) | ✅ | ☐ | | |
| 0.3 | Integration / rooftop smoke pass | ✅ | ☐ | | |
| 0.4 | RLS registry complete (`check:rls-registry`) | ✅ | ☐ | | |
| 0.5 | API default-deny (`check:api-routes`) | ✅ | ☐ | | |
| 0.6 | No seed secrets in repo (`check:seed-secrets`) | ✅ | ☐ | | |

---

## 1. Automated validation (IT)

| # | Check | Command / action | Critical | Pass | Owner | Date |
|---|-------|------------------|----------|------|-------|------|
| 1.1 | Environment variables | `npm run validate:env` | ✅ | ☐ | | |
| 1.2 | Module env hygiene | `MODULES_FORCE_ENABLE` only known ids; `VOICE_TWILIO_SKIP_SIGNATURE` **off** in prod | ✅ | ☐ | | |
| 1.3 | Pre-deploy gate | `npm run validate:pre-deploy` | ✅ | ☐ | | |
| 1.4 | Pre-rollout suite | `npm run validate:pre-rollout` — **0 critical code failures** | ✅ | ☐ | | |
| 1.5 | Database migrations | D1 apply through latest (`UserMfa`, `EncryptionRotation`, AiJob, modules, …) | ✅ | ☐ | | |
| 1.6 | Module seed defaults | Provision creates `DealershipModule` rows; product modules off until contracted | ✅ | ☐ | | |
| 1.7 | Legacy PII / dual-key re-encryption | [Reencryption-Runbook.md](./Reencryption-Runbook.md) if upgrading or rotating | ☐ | ☐ | | |
| 1.8 | KV rate limiting | Production `KV_STORE` bound; Apex **fails closed** without KV | ✅ | ☐ | | |
| 1.9 | Build metadata | `NEXT_PUBLIC_BUILD_COMMIT` + `NEXT_PUBLIC_BUILD_DATE` stamped | ☐ | ☐ | | |
| 1.10 | Dual-key + full reencrypt plan (incl. MFA) | Unit + `reencryptPlan.ts` inventory | ✅ | ☐ | | |

---

## 2. Security & compliance

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 2.1 | `GROK_API_KEY` server-only (no `NEXT_PUBLIC_*` xAI keys) | ✅ | ☐ | | |
| 2.2 | `SESSION_SECRET` ≥ 32 chars, unique | ✅ | ☐ | | |
| 2.3 | `DATA_ENCRYPTION_KEY` ≥ 32 chars (prefer 64 hex / base64url 48-byte) | ✅ | ☐ | | |
| 2.4 | `SEARCH_HMAC_KEY` different from data encryption key | ✅ | ☐ | | |
| 2.5 | Seed passwords rotated; no defaults left | ✅ | ☐ | | |
| 2.5a | **P0** `OWNER_SEED_PASSWORD*` **removed** from production Worker; `APEX_PLATFORM_OWNER_EMAILS` set | ✅ | ☐ | | |
| 2.5b | RLS tenant registry complete for all Prisma models | ✅ | ☐ | | |
| 2.5b2 | **Tenancy honesty** — **application-layer RLS on D1, not true DB RLS**; [Buyer Risk Acceptance](./Buyer-Risk-Acceptance-Summary.md) signed | ✅ | ☐ | | |
| 2.5c | API default-deny wrappers / intentional bare list | ✅ | ☐ | | |
| 2.5d | Manager `/api/health` — `database`, `kv`, `ownerSeedSecrets`, encryption not error | ✅ | ☐ | | |
| 2.5e | Product modules start **off** for provisioned rooftops | ✅ | ☐ | | |
| 2.5f | **MFA** — managers enrolled; **`MERLIN_MFA_ENFORCE=true`** for national production | ✅ | ☐ | | |
| 2.5g | Async AI — AiJob + queue consumer secret; long jobs use async path | ✅ | ☐ | | |
| 2.5g2 | **AI queue health (P0-4)** — unbound / depth≥200 / err≥50% / oldest≥45m / probe fail = **critical** (HTTP 503). Control Center `queueSignal` + guidance. Fallback ≠ healthy green | ✅ | ☐ | | |
| 2.5h | Bay cold-start warmup (`/api/session/warmup`) + SWR RO list | ☐ | ☐ | | |
| 2.5i | **Encryption rotation** — dual-key only during change; **full AES plan incl. MFA**; remove PREVIOUS only after reencrypt **and** MFA probe clean | ✅ | ☐ | | |
| 2.5j | CSRF double-submit on all mutating APIs (`merlin_csrf` + `X-Merlin-CSRF`) | ✅ | ☐ | | |
| 2.5k | CSP + security headers + HSTS active | ✅ | ☐ | | |
| 2.5l | Rate limits active (auth, MFA, AI, public share, queue consumer) | ✅ | ☐ | | |
| 2.6 | Manager security-status — no default passwords | ✅ | ☐ | | |
| 2.7 | Audit chain verified on sample dealership | ✅ | ☐ | | |
| 2.8 | Department / voice tickets encrypt PII fields | ✅ | ☐ | | |
| 2.9 | Twilio signature verification on in production | ✅ | ☐ | | |

---

## 3. Platform features (v4.1)

| # | Feature | Critical checks | Pass | Owner | Date |
|---|---------|-----------------|------|-------|------|
| 3.1 | Core RO story | Scan → notes → generate → certify → PDF/copy | ✅ | | |
| 3.2 | Async AI / AiJob | Job create → poll / SSE → complete | ☐ | | |
| 3.3 | Queue consumer | `AI_QUEUE_CONSUMER_SECRET` + CF Queue consumer; `queueSignal` not critical | ☐ | | |
| 3.3b | Companion concurrent edits | Train **last-write-wins**; dirty bay blocks full snapshot clobber | ☐ | | |
| 3.4 | Voice multi-dept | Service / Loaner / Parts / Sales + Twilio when entitled | ☐ | | |
| 3.5 | Personal Tailoring | Department customization persists; no PII in prompts | ☐ | | |
| 3.6 | Manager Control Center | `/manager/center` + live SSE + queue health banner | ☐ | | |
| 3.7 | Encryption rotation UI | Settings → full coverage incl. MFA → reencrypt | ☐ | | |
| 3.8 | Bay tablet / Desktop Command Center | Warmup, live sync, LWW process known | ☐ | | |

---

## 4. Dealership configuration

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 4.1 | Dealership display name correct | ✅ | ☐ | | |
| 4.2 | `NEXT_PUBLIC_APP_URL` matches production URL | ✅ | ☐ | | |
| 4.3 | `DAILY_USAGE_LIMIT` and timezone reviewed | ☐ | ☐ | | |
| 4.4 | Object storage (R2/Blob) for photos + video + voice | ✅ | ☐ | | |
| 4.5 | `MERLIN_MAINTENANCE_MODE` off for go-live | ✅ | ☐ | | |
| 4.6 | Sentry DSN configured | ☐ | ☐ | | |

---

## 5. Product modules (entitlements)

See [Product-Modules.md](./Product-Modules.md). Enable only contracted modules.

| # | Module | Critical checks | Pass |
|---|--------|-----------------|------|
| 5.1 | **core story** (not a module) | Always on | ☐ |
| 5.2 | `video_mpi` | List/create/share; storage OK | ☐ |
| 5.3 | `maintenance` / `parts` / `sales` / `service` / `loaner` | Role home + encrypted fields | ☐ |
| 5.4 | `voice_agent` (+ dept SKUs) | Twilio + signature; multi-dept | ☐ |
| 5.5 | `cdk_sync` | **Leave off** until credentials | N/A |
| 5.6 | Manager Modules UI | Toggle persists; `module.set` audit | ☐ |

---

## 6. Shop-floor UX (tablet)

Chrome/Edge on bay tablet, bright lighting.

| # | Check | Critical | Pass |
|---|-------|----------|------|
| 6.1 | Login (+ MFA if enforced) | ✅ | ☐ |
| 6.2 | Privacy consent | ✅ | ☐ |
| 6.3 | Scan RO → complaints | ✅ | ☐ |
| 6.4 | Voice dictation into notes | ✅ | ☐ |
| 6.5 | Generate warranty story | ✅ | ☐ |
| 6.6 | Customer Pay template | ✅ | ☐ |
| 6.7 | Copy / PDF export | ☐ | ☐ |
| 6.8 | Offline banner + save queue | ☐ | ☐ |
| 6.9 | Manager Control Center tiles + queue signal | ☐ | ☐ |

---

## 7. Monitoring, limits & ops notes

| Topic | Guidance |
|-------|----------|
| **SSE** | Job events + Control Center live — clients reconnect; tab-hidden pauses |
| **Queue** | CF Queues + HTTP consumer; `AI_QUEUE_CONSUMER_SECRET`; **critical** health on unbound/backlog/fail rate — page ops |
| **Worker CPU** | Long AI → durable AiJob; maxDuration on critical AI routes where applicable |
| **Cold start** | `/api/session/warmup`; bay keep-alive; SWR RO list |
| **Health** | `/api/health` — `database`, `kv`, `ownerSeedSecrets`, **`aiJobsQueue`**, encryption, `mfaPolicy` |
| **Rotation** | Dual-key warn until reencrypt + MFA probe clean; then remove PREVIOUS |
| **CSRF** | Cookie `merlin_csrf` + header `X-Merlin-CSRF` on mutations |
| **Companion** | Last-write-wins; train one editor per line |

---

## 8. Training & documentation

| # | Check | Critical | Pass |
|---|-------|----------|------|
| 8.1 | [Bay Reference Card](./Bay-Reference-Card.md) at tablets | ✅ | ☐ |
| 8.2 | [Training Outline](./Training-Outline.md) completed | ✅ | ☐ |
| 8.3 | [Support Playbook](./Support-Playbook.md) shared | ☐ | ☐ |
| 8.4 | Encryption rotation drill scheduled (or 90-day calendar) | ☐ | ☐ |
| 8.5 | Companion LWW + MFA process briefed to managers | ✅ | ☐ |
| 8.6 | Buyer risk acceptance signed (multi-store) | ✅ | ☐ |

---

## 9. Live Worker ops steps (required before traffic)

Execute on the **production Cloudflare Worker** (and AI queue consumer Worker). Order matters where noted.

| Step | Action | Done |
|------|--------|------|
| 9.1 | Deploy app Worker build **4.1.0** with stamped commit/date | ☐ |
| 9.2 | Apply remote D1 migrations through latest | ☐ |
| 9.3 | Secrets: `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_HMAC_KEY`, `GROK_API_KEY` | ☐ |
| 9.4 | Bindings: `DB` (D1), `KV_STORE`, R2/object storage as configured | ☐ |
| 9.5 | **Remove** `OWNER_SEED_PASSWORD*` from Worker; set `APEX_PLATFORM_OWNER_EMAILS` | ☐ |
| 9.6 | Ensure `DATA_ENCRYPTION_KEY_PREVIOUS` **unset** (except mid-rotation) | ☐ |
| 9.7 | AI: create/bind queues `merlinus-ai-jobs` (+ DLQ); set `AI_QUEUE_CONSUMER_SECRET` on app + consumer | ☐ |
| 9.8 | Deploy **ai-jobs-consumer** Worker with `APP_BASE_URL` → production app URL | ☐ |
| 9.9 | Enroll managers/owners in TOTP → set **`MERLIN_MFA_ENFORCE=true`** → redeploy | ☐ |
| 9.10 | `MERLIN_MAINTENANCE_MODE` off; Twilio signatures on if voice entitled | ☐ |
| 9.11 | Smoke: login/MFA → RO story → Control Center → health not 503; `queueSignal` not critical | ☐ |
| 9.12 | Confirm docs packet version 4.1.0 and risk acceptance filed | ☐ |

---

## 10. Residual risks (accepted for Conditional / national GO)

| ID | Residual | Mitigations | Acceptance |
|----|----------|-------------|------------|
| R1 | **App-layer tenancy only** (no DB RLS on D1) | Registry CI, `withSessionRls`, API wrappers, pen-test matrix | [Buyer Risk Acceptance](./Buyer-Risk-Acceptance-Summary.md) |
| R2 | **Platform-wide DEK** (single AES key for all rooftops) | Dual-key rotation, full reencrypt incl. MFA, secret hygiene | Buyer CISO |
| R3 | **Companion last-write-wins** | Dirty snapshot pause; process: one editor per line | Fixed Ops training |
| R4 | **AI inline fallback** can mask queue issues | Critical queue health + Control Center banners | Ops on-call |
| R5 | **KV rate-limit non-atomic** under multi-isolate flood | Fail-closed without KV; auth limits | Residual accepted for v4.1 |
| R6 | **No independent pen-test in-repo** | Buyer-commissioned test recommended pre-acquisition | Legal / security |

---

## 11. Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Dealership IT / Platform ops | | | |
| Service Manager | | | |
| Fixed Ops Director | | | |
| Customer CISO / security (multi-store) | | | |
| Customer legal / compliance (multi-store) | | | |
| Platform eng (Merlinus vendor) | | | |

**Deployment approved:** ☐ GO · ☐ Conditional GO (list conditions: _________) · ☐ NO-GO  

**Production URL:** ___________________________  
**App version:** 4.1.0  
**Build commit:** ___________________________  

---

## Quick reference

```bash
npm run ready-to-deploy
npm test
npm run check:rls-registry
npm run check:api-routes
# Strict production env gate (CI/CD only):
# MERLIN_DEPLOY_GATE=production npm run validate:pre-deploy
```

Live health: set `MERLIN_BASE_URL=https://your-deployment` before pre-rollout for remote probes.  
Diligence packet: this checklist + [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md) + [Security-Fortress.md](./Security-Fortress.md) + [Multi-Tenant-Isolation.md](./Multi-Tenant-Isolation.md).
