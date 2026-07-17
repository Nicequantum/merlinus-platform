# Go-Live Deployment Checklist (Modular Dealership OS)

**Audience:** Dealership IT, Platform ops, Fixed Ops Director  
**When to use:** At deploy time for production (or staging cutover) after module expansion (Video MPI, Maintenance, Parts/Sales/Service, Loaner, Voice).  
**Related:** [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) · [Go-Live-Checklist.md](./Go-Live-Checklist.md) (24–48h shop-floor gate) · [Product-Modules.md](./Product-Modules.md) · [Deployment-Checklist-and-Operations.md](./Deployment-Checklist-and-Operations.md)

**Version:** 3.1.0 · **Product surface:** Merlinus core story + product modules  
**Golden rule:** Core RO → evidence → warranty narrative is **always on** and is **not** module-gated.

---

## Dealership / deployment identity

| Field | Value |
|-------|-------|
| Dealership / rooftop | |
| Environment | ☐ Staging ☐ Production |
| Vercel project | |
| Production URL | |
| Deploy commit SHA | |
| Deploy date (UTC) | |
| Operator | |

---

## Phase 0 — Pre-flight (blockers)

| # | Check | Critical | Pass |
|---|-------|----------|------|
| 0.1 | Branch/commit approved for release | ✅ | ☐ |
| 0.2 | `npm run validate:env` passes against production-shaped env | ✅ | ☐ |
| 0.3 | `npm run validate:pre-deploy` — **0 code failures** | ✅ | ☐ |
| 0.4 | `npm run validate:pre-rollout` — **0 critical failures** | ✅ | ☐ |
| 0.5 | `npm test` — unit suite green (note any known DB-dependent skips) | ✅ | ☐ |
| 0.6 | `npm run typecheck` passes | ✅ | ☐ |
| 0.7 | No `NEXT_PUBLIC_*` xAI / Grok keys | ✅ | ☐ |
| 0.8 | `VOICE_TWILIO_SKIP_SIGNATURE` **unset** / false in production | ✅ | ☐ |
| 0.9 | `MODULES_FORCE_ENABLE` empty in production (prefer Manager toggles) | ☐ | ☐ |
| 0.10 | `MERLIN_MAINTENANCE_MODE` off unless intentional freeze | ✅ | ☐ |

---

## Phase 1 — Secrets & platform env

| # | Variable / item | Critical | Pass |
|---|-----------------|----------|------|
| 1.1 | `DATABASE_URL` (or Apex Supabase resolution) | ✅ | ☐ |
| 1.2 | `DATA_ENCRYPTION_KEY` — 64 hex, vaulted | ✅ | ☐ |
| 1.3 | `SEARCH_HMAC_KEY` — 64 hex, **≠** encryption key | ✅ | ☐ |
| 1.4 | `SESSION_SECRET` ≥ 32 chars | ✅ | ☐ |
| 1.5 | `GROK_API_KEY` server-only | ✅ | ☐ |
| 1.6 | `BLOB_READ_WRITE_TOKEN` (RO photos + Video MPI + voice recordings) | ✅ | ☐ |
| 1.7 | `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Apex production **hard**) | ✅ | ☐ |
| 1.8 | `NEXT_PUBLIC_APP_URL` matches live host | ✅ | ☐ |
| 1.9 | `NEXT_PUBLIC_SENTRY_DSN` configured | ✅ | ☐ |
| 1.10 | Auth mode + Clerk keys if `AUTH_MODE` is dual/clerk | ☐ | ☐ |
| 1.11 | Seed passwords rotated / no defaults | ✅ | ☐ |

---

## Phase 2 — Module-specific env (only if module will be used)

| Module | Env / config | Critical if module on | Pass |
|--------|--------------|----------------------|------|
| **video_mpi** | Blob token; optional `SMS_ENABLED` + full Twilio SMS trio | ✅ / SMS ☐ | ☐ |
| **maintenance** | No extra env (module row + role) | ☐ | ☐ |
| **parts / sales / service** | Module rows + staff roles | ☐ | ☐ |
| **loaner** | Module row + loaner role | ☐ | ☐ |
| **voice_agent** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`; public URL for webhooks; DID lines configured in app | ✅ | ☐ |
| **cdk_sync** | **Deferred** — leave disabled until PR-M7 credentials | ☐ N/A | ☐ |

See [Product-Modules.md](./Product-Modules.md) for resolution order and seed defaults.

---

## Phase 3 — Database & seed

| # | Check | Critical | Pass |
|---|-------|----------|------|
| 3.1 | `npx prisma migrate deploy` on target DB (includes department sales/service + module enums) | ✅ | ☐ |
| 3.2 | `npm run db:seed` (or provision) creates module defaults for rooftops | ✅ | ☐ |
| 3.3 | Confirm `DealershipModule` rows for shippable modules (cdk_sync off) | ✅ | ☐ |
| 3.4 | Manager login works; Settings can create parts/sales/service/loaner/maintenance roles | ✅ | ☐ |
| 3.5 | Audit chain probe / sample verify if required by policy | ☐ | ☐ |

---

## Phase 4 — Deploy

| # | Check | Critical | Pass |
|---|-------|----------|------|
| 4.1 | Deploy to Vercel (or host) with production env attached | ✅ | ☐ |
| 4.2 | Build stamps: `NEXT_PUBLIC_BUILD_COMMIT` / `NEXT_PUBLIC_BUILD_DATE` present in footer | ☐ | ☐ |
| 4.3 | `GET /api/status` → maintenance false, version matches | ✅ | ☐ |
| 4.4 | `GET /api/health` (manager cookie or internal) → ok / approved degraded | ✅ | ☐ |
| 4.5 | Sentry receives a test event / or verified DSN project | ☐ | ☐ |
| 4.6 | No CSP/auth console errors on login | ✅ | ☐ |

---

## Phase 5 — Functional smoke (per enabled module)

| # | Smoke | Critical | Pass |
|---|-------|----------|------|
| 5.1 | **Core story:** login → scan/open RO → generate story → copy | ✅ | ☐ |
| 5.2 | **Modules UI:** Manager Dashboard → Modules → toggle off/on persists | ✅ | ☐ |
| 5.3 | **video_mpi:** create inspection list loads (or disabled notice) | ☐ | ☐ |
| 5.4 | **maintenance:** board loads for manager/maintenance role | ☐ | ☐ |
| 5.5 | **parts / sales / service:** inbox list + create manual request | ☐ | ☐ |
| 5.6 | **loaner:** fleet board loads | ☐ | ☐ |
| 5.7 | **voice_agent:** ops dashboard loads; Twilio webhook signature verified on test call if live | ☐ | ☐ |
| 5.8 | Disabled module shows “Manager Dashboard → Modules” empty state | ☐ | ☐ |

---

## Phase 6 — Security post-deploy

| # | Check | Critical | Pass |
|---|-------|----------|------|
| 6.1 | Department / voice tickets store encrypted customer fields (spot-check DB or app only shows decrypted in session) | ✅ | ☐ |
| 6.2 | Public video share routes require token (no open listing) | ✅ | ☐ |
| 6.3 | Rate limiting works (login throttle) with KV in prod | ✅ | ☐ |
| 6.4 | `module.set` audit entries appear when toggles used | ☐ | ☐ |
| 6.5 | Sentry events scrub PII (no raw phone/VIN in extras) | ☐ | ☐ |

---

## Phase 7 — Sign-off

| Role | Name | Go / No-Go | Date |
|------|------|------------|------|
| Dealership IT | | ☐ Go ☐ No-Go | |
| Service Manager / FO | | ☐ Go ☐ No-Go | |
| Platform operator | | ☐ Go ☐ No-Go | |

**Production URL:** ________________________________  
**Rollback plan:** previous Vercel deployment / pin prior commit: ________________________________

---

## Quick command block

```bash
npm run validate:env
npm run validate:pre-deploy
npm run validate:pre-rollout
npm test
npm run typecheck
npx prisma migrate deploy
npm run db:seed          # or provision-dealer for new rooftops
npm run build
# After deploy:
# curl -sS "$MERLIN_BASE_URL/api/status"
```
