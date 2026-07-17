# Merlin Production Readiness Checklist

**Version:** 3.0.0 · **Prompt:** 3.0.0
**Purpose:** Mandatory sign-off before deploying Merlin to any dealership tablet fleet.

Complete every section. A deployment is **blocked** until all **Critical** items pass and signatories are recorded.

---

## 1. Automated validation (IT)

| # | Check | Command / action | Critical | Pass | Owner | Date |
|---|-------|------------------|----------|------|-------|------|
| 1.1 | Environment variables | `npm run validate:env` | ✅ | ☐ | | |
| 1.2 | Pre-rollout suite | `npm run validate:pre-rollout` — **0 critical failures** | ✅ | ☐ | | |
| 1.3 | Unit tests | `npm test` — all pass | ✅ | ☐ | | |
| 1.4 | Integration tests | `npm run test:integration` — all pass | ✅ | ☐ | | |
| 1.5 | Database migrations | `npx prisma migrate deploy` on target DB (Phase 6.2 RLS uses `DealerGroupMembership.technician_id` snake_case) | ✅ | ☐ | | |
| 1.6 | Legacy PII re-encryption | Follow [Reencryption-Runbook.md](./Reencryption-Runbook.md) if upgrading | ☐ | ☐ | | |
| 1.7 | KV rate limiting (Phase 6.4–6.5) | `KV_REST_API_URL` + `KV_REST_API_TOKEN` on **Production** Vercel env; Apex production **fails closed** without KV (no memory fallback); no `rate_limit.apex_kv_required` / `production_kv_missing` at healthy startup | ✅ | ☐ | | |
| 1.8 | Security Hardening Sprint (6.1–6.5) | Pre-rollout **APEX 6.1–6.5** all PASS; [Security-Fortress.md](./Security-Fortress.md) sprint **complete and production-ready**; RLS migrations applied on target DB | ✅ | ☐ | | |
| 1.8b | Enterprise cleanup (7.1–7.3) | Phase 7.3 migration `20250716120000_apex_phase7_3_timezone_indexes` applied; docs mark **7.1–7.3 complete** | ✅ | ☐ | | |
| 1.9 | Build metadata | `NEXT_PUBLIC_BUILD_COMMIT` + `NEXT_PUBLIC_BUILD_DATE` stamped | ☐ | ☐ | | |

---

## 2. Security & compliance

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 2.1 | `GROK_API_KEY` server-only (no `NEXT_PUBLIC_*` xAI keys) | ✅ | ☐ | | |
| 2.2 | `SESSION_SECRET` ≥ 32 chars, unique per deployment | ✅ | ☐ | | |
| 2.3 | `ENCRYPTION_KEY` 64 hex chars, unique per deployment | ✅ | ☐ | | |
| 2.4 | Seed passwords rotated (`ADMIN_SEED_PASSWORD`, `TECH_SEED_PASSWORD`) | ✅ | ☐ | | |
| 2.5 | Manager can view `/api/auth/security-status` — no default passwords | ✅ | ☐ | | |
| 2.6 | Audit chain verified on sample dealership | ✅ | ☐ | | |
| 2.7 | Customer Pay templates bypass Grok — audit uses `customerPayTemplateApplied` | ✅ | ☐ | | |
| 2.8 | Security Hardening Sprint (6.1–6.5) baseline | ✅ | ☐ | | |
| 2.9 | Enterprise Readiness Cleanup (7.1–7.3) complete | ✅ | ☐ | | |

---

## 3. Dealership configuration

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 3.1 | `DEALERSHIP_DISPLAY_NAME` set (appears in PDF + UI) | ✅ | ☐ | | |
| 3.2 | `DEALERSHIP_CODE` set for internal reference | ☐ | ☐ | | |
| 3.3 | `NEXT_PUBLIC_APP_URL` matches production URL | ✅ | ☐ | | |
| 3.4 | `DAILY_USAGE_LIMIT` and `USAGE_TIMEZONE` reviewed | ☐ | ☐ | | |
| 3.5 | `BLOB_READ_WRITE_TOKEN` configured for image uploads | ✅ | ☐ | | |
| 3.6 | `MERLIN_MAINTENANCE_MODE` off for go-live | ✅ | ☐ | | |

---

## 4. Shop-floor UX verification (tablet)

Test on **Chrome or Edge** on the actual bay tablet in bright lighting.

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 4.1 | Login with D7 number + password | ✅ | ☐ | | |
| 4.2 | Privacy consent accepted | ✅ | ☐ | | |
| 4.3 | Scan RO → complaints extracted | ✅ | ☐ | | |
| 4.4 | Voice input — mic permission, dictation into notes | ✅ | ☐ | | |
| 4.5 | Generate warranty story (Grok) | ✅ | ☐ | | |
| 4.6 | Customer Pay template — instant apply, green badge | ✅ | ☐ | | |
| 4.7 | Copy story to clipboard for CDK | ✅ | ☐ | | |
| 4.8 | PDF export downloads | ☐ | ☐ | | |
| 4.9 | Offline banner appears when Wi‑Fi disconnected | ☐ | ☐ | | |
| 4.10 | Load-error retry screen if API unreachable | ☐ | ☐ | | |

---

## 5. Training & documentation

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 5.1 | [Bay Reference Card](./Bay-Reference-Card.md) laminated at each tablet | ✅ | ☐ | | |
| 5.2 | Technicians trained per [Training Outline](./Training-Outline.md) | ✅ | ☐ | | |
| 5.3 | [Support Playbook](./Support-Playbook.md) shared with IT + Service Manager | ☐ | ☐ | | |
| 5.4 | [Go-Live Checklist](./Go-Live-Checklist.md) completed | ✅ | ☐ | | |

---

## 6. Sign-off

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
npm run validate:pre-rollout
npm test
npm run test:integration
npx prisma migrate deploy
npm run build
```

Live health check (optional): set `MERLIN_BASE_URL=https://your-deployment` before `validate:pre-rollout`.