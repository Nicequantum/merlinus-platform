# Merlinus Apex — Production Readiness Checklist

**Version:** 4.1.0 · **Prompt:** 4.1.0 · **Updated:** 2026-07-21  
**Purpose:** **Single source of truth** for go-live sign-off before production traffic on any rooftop (core RO story, Async AI, Voice multi-department + tailoring, Manager Control Center, MFA, Encryption Rotation, Bay tablet polish).

A deployment is **blocked** until all **Critical** items pass and signatories are recorded.

| Related runbook | Use when |
|-----------------|----------|
| [Rollout-Runbook.md](./Rollout-Runbook.md) | End-to-end multi-store rollout |
| [Go-Live-Deployment-Checklist.md](./Go-Live-Deployment-Checklist.md) | Deploy-day steps |
| [Deployment-Checklist-and-Operations.md](./Deployment-Checklist-and-Operations.md) | Infra + ops day-2 |
| [Reencryption-Runbook.md](./Reencryption-Runbook.md) | Dual-key PII key rotation |
| [Security-Fortress.md](./Security-Fortress.md) | MFA, dual-key, fortress controls |
| [Product-Modules.md](./Product-Modules.md) | Module entitlements per rooftop |

**Golden rules**

1. Core RO story pipeline is **always on** — never a toggleable product module.  
2. `DATA_ENCRYPTION_KEY_PREVIOUS` is **only** set during active key rotation.  
3. Prefer Manager → Modules over `MODULES_FORCE_ENABLE` in production.  
4. Recommend **`MERLIN_MFA_ENFORCE=true`** after managers enroll TOTP.  
5. Recommend encryption key rotation every **90 days**.

---

## 0. Engineering gate (must exit 0)

```bash
npm run ready-to-deploy   # seed secrets + RLS registry + API routes + pre-deploy + pre-rollout
npm test                  # unit
npm run test:integration  # integration (needs DB if scenarios hit live data)
npm run typecheck         # optional CI parity
npm run check:rls-registry
```

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 0.1 | `npm run ready-to-deploy` exit 0 (code failures only block local; set `MERLIN_DEPLOY_GATE=production` for strict env) | ✅ | ☐ | | |
| 0.2 | Unit tests pass | ✅ | ☐ | | |
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
| 1.5 | Database migrations | Deploy through latest (incl. `EncryptionRotation`, `UserMfa`, AiJob, modules) | ✅ | ☐ | | |
| 1.6 | Module seed defaults | Provision creates `DealershipModule` rows; product modules off until contracted | ✅ | ☐ | | |
| 1.7 | Legacy PII re-encryption | [Reencryption-Runbook.md](./Reencryption-Runbook.md) if upgrading | ☐ | ☐ | | |
| 1.8 | KV rate limiting | Production KV (or Workers KV binding); Apex production **fails closed** without KV | ✅ | ☐ | | |
| 1.9 | Build metadata | `NEXT_PUBLIC_BUILD_COMMIT` + `NEXT_PUBLIC_BUILD_DATE` stamped | ☐ | ☐ | | |
| 1.10 | Dual-key encryption unit coverage | `encryptionRotation` + dual-key decrypt tests | ✅ | ☐ | | |

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
| 2.5c | API default-deny: all routes use wrappers or intentional bare list | ✅ | ☐ | | |
| 2.5d | Manager `/api/health` GREEN for `database`, `kv`, `ownerSeedSecrets`, encryption | ✅ | ☐ | | |
| 2.5e | Product modules start **off** for provisioned rooftops (demo may enable pilot SKUs) | ✅ | ☐ | | |
| 2.5f | **MFA** — managers enrolled; **`MERLIN_MFA_ENFORCE=true` recommended** for production | ✅ | ☐ | | |
| 2.5g | Async AI — AiJob + queue consumer secret; long jobs use async path | ☐ | ☐ | | |
| 2.5h | Bay cold-start warmup (`/api/session/warmup`) + SWR RO list | ☐ | ☐ | | |
| 2.5i | **Encryption rotation** — dual-key only during change; remove PREVIOUS after reencrypt; 90-day cadence | ✅ | ☐ | | |
| 2.5j | CSRF double-submit (`merlin_csrf` + `X-Merlin-CSRF`) | ✅ | ☐ | | |
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
| 3.2 | Async AI / AiJob | Job create → poll / SSE events → complete | ☐ | | |
| 3.3 | Queue consumer | `AI_QUEUE_CONSUMER_SECRET` + companion or CF Queue | ☐ | | |
| 3.4 | Voice multi-dept | Service / Loaner / Parts / Sales query + Twilio when entitled | ☐ | | |
| 3.5 | Personal Tailoring | Department customization persists; no PII in prompts | ☐ | | |
| 3.6 | Manager Control Center | `/manager/center` Overview/Jobs/Voice/Modules/Health + live SSE | ☐ | | |
| 3.7 | Encryption rotation UI | Settings → fingerprints → begin / reencrypt / cancel | ☐ | | |
| 3.8 | Bay tablet | Offline queue, pull-to-refresh, warm RO list | ☐ | | |

---

## 4. Dealership configuration

| # | Check | Critical | Pass | Owner | Date |
|---|-------|----------|------|-------|------|
| 4.1 | `DEALERSHIP_DISPLAY_NAME` / dealership record name | ✅ | ☐ | | |
| 4.2 | `NEXT_PUBLIC_APP_URL` matches production URL | ✅ | ☐ | | |
| 4.3 | `DAILY_USAGE_LIMIT` and timezone reviewed | ☐ | ☐ | | |
| 4.4 | Object storage (Blob/R2) for photos + video + voice | ✅ | ☐ | | |
| 4.5 | `MERLIN_MAINTENANCE_MODE` off for go-live | ✅ | ☐ | | |
| 4.6 | Sentry DSN configured | ☐ | ☐ | | |

---

## 5. Product modules (entitlements)

See [Product-Modules.md](./Product-Modules.md). Enable only contracted modules.

| # | Module | Critical checks | Pass |
|---|--------|-----------------|------|
| 5.1 | **core story** (not a module) | Always on | ☐ |
| 5.2 | `video_mpi` | List/create/share; Blob OK | ☐ |
| 5.3 | `maintenance` / `parts` / `sales` / `service` / `loaner` | Role home + encrypted fields | ☐ |
| 5.4 | `voice_agent` (+ dept SKUs) | Twilio + signature; multi-dept | ☐ |
| 5.5 | `cdk_sync` | **Leave off** until credentials | N/A |
| 5.6 | Manager Modules UI | Toggle persists; `module.set` audit | ☐ |

---

## 6. Shop-floor UX (tablet)

Chrome/Edge on bay tablet, bright lighting.

| # | Check | Critical | Pass |
|---|-------|----------|------|
| 6.1 | Login D7 + password (+ MFA if enforced) | ✅ | ☐ |
| 6.2 | Privacy consent | ✅ | ☐ |
| 6.3 | Scan RO → complaints | ✅ | ☐ |
| 6.4 | Voice dictation into notes | ✅ | ☐ |
| 6.5 | Generate warranty story | ✅ | ☐ |
| 6.6 | Customer Pay template | ✅ | ☐ |
| 6.7 | Copy / PDF export | ☐ | ☐ |
| 6.8 | Offline banner + save queue | ☐ | ☐ |
| 6.9 | Manager Control Center tiles | ☐ | ☐ |

---

## 7. Monitoring, limits & ops notes

| Topic | Guidance |
|-------|----------|
| **SSE** | Job events + Control Center live streams — Worker request duration / concurrent connection limits apply; clients reconnect |
| **Queue** | Prefer CF Queues + HTTP consumer bridge; set `AI_QUEUE_CONSUMER_SECRET`; monitor AiJob stuck/failed |
| **Worker CPU** | Long AI paths use async AiJob where possible; maxDuration set on critical AI routes (Node deploy) |
| **Cold start** | Post-login `/api/session/warmup`; bay keep-alive; SWR RO list cache |
| **Health** | `/api/health` — watch `encryption` dual-key warn, `mfaPolicy`, `voiceDepartments`, `aiJobs`, KV |
| **Rotation** | Health warns while dual-key active or rotation running — finish reencrypt and remove PREVIOUS |

---

## 8. Training & documentation

| # | Check | Critical | Pass |
|---|-------|----------|------|
| 8.1 | [Bay Reference Card](./Bay-Reference-Card.md) at tablets | ✅ | ☐ |
| 8.2 | [Training Outline](./Training-Outline.md) completed | ✅ | ☐ |
| 8.3 | [Support Playbook](./Support-Playbook.md) shared | ☐ | ☐ |
| 8.4 | Encryption rotation drill scheduled (or 90-day calendar) | ☐ | ☐ |

---

## 9. Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Dealership IT | | | |
| Service Manager | | | |
| Fixed Ops Director | | | |
| Platform eng (Merlinus) | | | |

**Deployment approved:** ☐ Yes ☐ No  
**Production URL:** ___________________________  
**App version:** 4.1.0  

---

## Quick reference

```bash
npm run ready-to-deploy
npm test
npm run test:integration
# Strict production env gate (CI/CD only):
# MERLIN_DEPLOY_GATE=production npm run validate:pre-deploy
```

Live health: set `MERLIN_BASE_URL=https://your-deployment` before pre-rollout for remote `/api/health`.
