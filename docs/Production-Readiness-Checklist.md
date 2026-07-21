# Merlin Production Readiness Checklist

**Version:** 3.1.0 · **Prompt:** 3.0.0  
**Purpose:** Mandatory sign-off before deploying Merlin / Apex dealership OS to any rooftop tablet fleet — including product modules (Video MPI, Maintenance, Parts/Sales/Service, Loaner, Voice).

Complete every section. A deployment is **blocked** until all **Critical** items pass and signatories are recorded.

**Related:** [Go-Live-Deployment-Checklist.md](./Go-Live-Deployment-Checklist.md) · [Product-Modules.md](./Product-Modules.md) · [Go-Live-Checklist.md](./Go-Live-Checklist.md)

**Golden rule:** Core RO story pipeline is **always on** and is **never** a toggleable product module.

---

## 1. Automated validation (IT)

| # | Check | Command / action | Critical | Pass | Owner | Date |
|---|-------|------------------|----------|------|-------|------|
| 1.1 | Environment variables | `npm run validate:env` | ✅ | ☐ | | |
| 1.2 | Module env hygiene | `MODULES_FORCE_ENABLE` only known ids; `VOICE_TWILIO_SKIP_SIGNATURE` off in prod; Twilio/SMS consistency | ✅ | ☐ | | |
| 1.3 | Pre-deploy gate | `npm run validate:pre-deploy` — **0 code failures** (includes module PII + Twilio guards) | ✅ | ☐ | | |
| 1.4 | Pre-rollout suite | `npm run validate:pre-rollout` — **0 critical failures** | ✅ | ☐ | | |
| 1.5 | Unit tests | `npm test` — all pass | ✅ | ☐ | | |
| 1.6 | Integration tests | `npm run test:integration` — all pass | ✅ | ☐ | | |
| 1.7 | Database migrations | `npx prisma migrate deploy` on target DB (through `department_sales_service` + module enums) | ✅ | ☐ | | |
| 1.8 | Module seed defaults | `npm run db:seed` or provision creates `DealershipModule` rows (shippable on, `cdk_sync` off) | ✅ | ☐ | | |
| 1.9 | Legacy PII re-encryption | Follow [Reencryption-Runbook.md](./Reencryption-Runbook.md) if upgrading | ☐ | ☐ | | |
| 1.10 | KV rate limiting (Phase 6.4–6.5) | `KV_REST_API_URL` + `KV_REST_API_TOKEN` on **Production**; Apex production **fails closed** without KV | ✅ | ☐ | | |
| 1.11 | Security Hardening Sprint (6.1–6.5) | Pre-rollout **APEX 6.1–6.5** PASS; [Security-Fortress.md](./Security-Fortress.md) complete | ✅ | ☐ | | |
| 1.12 | Enterprise cleanup (7.1–7.3) | Phase 7.3 migration applied; docs mark **7.1–7.3 complete** | ✅ | ☐ | | |
| 1.13 | Build metadata | `NEXT_PUBLIC_BUILD_COMMIT` + `NEXT_PUBLIC_BUILD_DATE` stamped | ☐ | ☐ | | |
| 1.14 | Typecheck | `npm run typecheck` | ✅ | ☐ | | |

---

## 2. Security & compliance

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 2.1 | `GROK_API_KEY` server-only (no `NEXT_PUBLIC_*` xAI keys) | ✅ | ☐ | | |
| 2.2 | `SESSION_SECRET` ≥ 32 chars, unique per deployment | ✅ | ☐ | | |
| 2.3 | `DATA_ENCRYPTION_KEY` 64 hex chars, unique per deployment (legacy `ENCRYPTION_KEY` alias is dev-only) | ✅ | ☐ | | |
| 2.4 | `SEARCH_HMAC_KEY` 64 hex, **different** from data encryption key | ✅ | ☐ | | |
| 2.5 | Seed passwords rotated (`ADMIN_SEED_PASSWORD`, `TECH_SEED_PASSWORD`) | ✅ | ☐ | | |
| 2.5a | **P0** `OWNER_SEED_PASSWORD*` **removed** from production Worker (no seed passwords without `ALLOW_OWNER_SEED_BOOTSTRAP`); `APEX_PLATFORM_OWNER_EMAILS` set; `/api/health` `ownerSeedSecrets` ok; `npm run check:seed-secrets` pass | ✅ | ☐ | | |
| 2.5b | **P0-5** RLS tenant registry complete: `npm run check:rls-registry` pass; any new Prisma models registered in `src/lib/apex/rlsTenantRegistry.ts` (DIRECT / RELATION / PLATFORM) + unit test | ✅ | ☐ | | |
| 2.5c | **P0-4** API default-deny: `npm run check:api-routes` pass; new routes use `withAuth` / `withPublicRoute` / `withStoryAiRoute` or documented bare allowlist | ✅ | ☐ | | |
| 2.5d | **P0-3** Manager `/api/health` GREEN for critical deps (`database`, `kv`, `ownerSeedSecrets`); module-aware Twilio when `voice_agent` on; SMS config if `SMS_ENABLED` | ✅ | ☐ | | |
| 2.5e | **P1-4** Provisioned rooftops start with product modules **off** (enable per contract); demo seed may still enable pilot SKUs | ✅ | ☐ | | |
| 2.5f | **P1-3** If `MERLIN_MFA_ENFORCE=true`, managers/owners must enroll TOTP (`/api/auth/mfa/*`) before PII routes | ☐ | ☐ | | |
| 2.5g | **P1-1** Long hub summarize can use `{ "async": true }` + poll `/api/ai-jobs/:id` (AiJob table migrated) | ☐ | ☐ | | |
| 2.5h | **P1-2** Post-login + bay keep-alive warmup active (`/api/session/warmup`) | ☐ | ☐ | | |
| 2.5i | **P1-5** Dual-key rotation: `DATA_ENCRYPTION_KEY_PREVIOUS` only during key change; removed after reencrypt | ☐ | ☐ | | |
| 2.5j | **P1-6** CSRF double-submit active in production (`merlin_csrf` + `X-Merlin-CSRF`) | ☐ | ☐ | | |
| 2.5k | **P1-7** Rooftop smoke integration passes (`tests/integration/rooftop-smoke.test.ts`) | ☐ | ☐ | | |
| 2.5l | **P2** Rollout uses [Rollout-Runbook.md](./Rollout-Runbook.md); README has no inflated audit scores; CF `KV_STORE` + observability sampling 0.1; manager passwords meet complexity policy | ☐ | ☐ | | |
| 2.5m | **P3** Isolation stance documented ([Multi-Tenant-Isolation.md](./Multi-Tenant-Isolation.md)); CDK deferred ([CDK-Sync-Deferred.md](./CDK-Sync-Deferred.md)); Gather is prod voice; recovery only if `MERLIN_PASSWORD_RECOVERY_ENABLED` | ☐ | ☐ | | |
| 2.6 | Manager can view `/api/auth/security-status` — no default passwords | ✅ | ☐ | | |
| 2.7 | Audit chain verified on sample dealership | ✅ | ☐ | | |
| 2.8 | Customer Pay templates bypass Grok — audit uses `customerPayTemplateApplied` | ✅ | ☐ | | |
| 2.9 | Department / voice tickets encrypt customer name, phone, email, VIN, summary | ✅ | ☐ | | |
| 2.10 | `module.set` audited when managers toggle modules | ✅ | ☐ | | |
| 2.11 | Twilio signature verification on in production (no `VOICE_TWILIO_SKIP_SIGNATURE`) | ✅ | ☐ | | |
| 2.12 | Security Hardening Sprint (6.1–6.5) baseline | ✅ | ☐ | | |
| 2.13 | Enterprise Readiness Cleanup (7.1–7.3) complete | ✅ | ☐ | | |

---

## 3. Dealership configuration

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 3.1 | `DEALERSHIP_DISPLAY_NAME` set (appears in PDF + UI) | ✅ | ☐ | | |
| 3.2 | `DEALERSHIP_CODE` set for internal reference | ☐ | ☐ | | |
| 3.3 | `NEXT_PUBLIC_APP_URL` matches production URL | ✅ | ☐ | | |
| 3.4 | `DAILY_USAGE_LIMIT` and `USAGE_TIMEZONE` reviewed | ☐ | ☐ | | |
| 3.5 | `BLOB_READ_WRITE_TOKEN` configured (RO photos + Video MPI + voice recordings) | ✅ | ☐ | | |
| 3.6 | `MERLIN_MAINTENANCE_MODE` off for go-live | ✅ | ☐ | | |
| 3.7 | `NEXT_PUBLIC_SENTRY_DSN` configured; release/env tags expected | ✅ | ☐ | | |

---

## 4. Product modules (entitlements)

See [Product-Modules.md](./Product-Modules.md). Enable only modules this rooftop will use.

| # | Module | Seed default | Critical checks | Pass | Owner | Date |
|---|--------|--------------|-----------------|------|-------|------|
| 4.1 | **core story** (not a module) | Always on | RO list → story generate → copy/PDF | ☐ | | |
| 4.2 | `video_mpi` | On | Manager toggle works; list/create; disabled notice if off; Blob OK | ☐ | | |
| 4.3 | `maintenance` | On | Board loads; submit ticket; maintenance role optional | ☐ | | |
| 4.4 | `parts` | On | Parts role/home or manager tile; create request; encrypted fields | ☐ | | |
| 4.5 | `sales` | On | Sales role/home or manager tile; voice ticket lands when voice on | ☐ | | |
| 4.6 | `service` | On | Service role/home or manager tile; voice ticket lands when voice on | ☐ | | |
| 4.7 | `loaner` | On | Fleet board; loaner role optional | ☐ | | |
| 4.8 | `voice_agent` | On | Ops dashboard; Twilio SID/token; webhook signature; lines configured | ☐ | | |
| 4.9 | `cdk_sync` | **Off** | Leave disabled until PR-M7 + credentials | ☐ N/A | | |
| 4.10 | Manager Modules UI | — | Turn on/off persists; force-env modules locked; audit `module.set` | ✅ | | |

---

## 5. Shop-floor UX verification (tablet)

Test on **Chrome or Edge** on the actual bay tablet in bright lighting.

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 5.1 | Login with D7 number + password | ✅ | ☐ | | |
| 5.2 | Privacy consent + legal disclaimer accepted | ✅ | ☐ | | |
| 5.3 | Scan RO → complaints extracted | ✅ | ☐ | | |
| 5.4 | Voice input — mic permission, dictation into notes | ✅ | ☐ | | |
| 5.5 | Generate warranty story (Grok) | ✅ | ☐ | | |
| 5.6 | Customer Pay template — instant apply, green badge | ✅ | ☐ | | |
| 5.7 | Copy story to clipboard for CDK | ✅ | ☐ | | |
| 5.8 | PDF export downloads | ☐ | ☐ | | |
| 5.9 | Offline banner appears when Wi‑Fi disconnected | ☐ | ☐ | | |
| 5.10 | Load-error retry screen if API unreachable | ☐ | ☐ | | |
| 5.11 | Manager: open each enabled module tile without crash | ☐ | ☐ | | |
| 5.12 | Department staff roles land on correct inbox (not RO list) | ☐ | ☐ | | |

---

## 6. Monitoring & support

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 6.1 | Sentry DSN live; sample error or health path observed | ✅ | ☐ | | |
| 6.2 | Structured logs include `requestId`; module events (`module.set`, `module.disabled_blocked`) | ☐ | ☐ | | |
| 6.3 | [Support Playbook](./Support-Playbook.md) lists module disable path (Manager → Modules) | ☐ | ☐ | | |
| 6.4 | On-call knows force-enable is break-glass only | ☐ | ☐ | | |

---

## 7. Training & documentation

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 7.1 | [Bay Reference Card](./Bay-Reference-Card.md) laminated at each tablet | ✅ | ☐ | | |
| 7.2 | Technicians trained per [Training Outline](./Training-Outline.md) | ✅ | ☐ | | |
| 7.3 | [Support Playbook](./Support-Playbook.md) shared with IT + Service Manager | ☐ | ☐ | | |
| 7.4 | [Go-Live Checklist](./Go-Live-Checklist.md) completed (24–48h) | ✅ | ☐ | | |
| 7.5 | [Go-Live Deployment Checklist](./Go-Live-Deployment-Checklist.md) completed at deploy | ✅ | ☐ | | |
| 7.6 | [Product-Modules.md](./Product-Modules.md) reviewed for this rooftop’s plan | ☐ | ☐ | | |

---

## 8. Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Dealership IT | | | |
| Service Manager | | | |
| Fixed Ops Director | | | |

**Deployment approved:** ☐ Yes ☐ No — **Vercel deployment URL:** ___________________________

---

## Quick reference

```bash
cp .env.example .env.local    # first-time setup
npm run validate:env
npm run validate:pre-deploy
npm run validate:pre-rollout
npm test
npm run typecheck
npx prisma migrate deploy
npm run db:seed               # module defaults for rooftops
npm run build
```

Live health check (optional): set `MERLIN_BASE_URL=https://your-deployment` before `validate:pre-rollout`.

Deploy-time step-by-step: [Go-Live-Deployment-Checklist.md](./Go-Live-Deployment-Checklist.md).
