# Merlinus / Apex — Unified Rollout Runbook

**Audience:** Platform ops, dealership IT, go-live leads  
**Purpose:** Single entry point for multi-rooftop rollout. Prefer this over older overlapping checklists when they disagree.

| Related | Use when |
|---------|----------|
| [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) | Sign-off grid before traffic |
| [Deployment-Checklist-and-Operations.md](./Deployment-Checklist-and-Operations.md) | Env vars and deploy commands |
| [Product-Modules.md](./Product-Modules.md) | SKU entitlements per rooftop |
| [Reencryption-Runbook.md](./Reencryption-Runbook.md) | Key rotation / dual-key window |
| [Admin-Setup-Guide.md](./Admin-Setup-Guide.md) | Day-2 admin operations |

---

## 1. Pre-flight (every environment)

```bash
npm run check:seed-secrets
npm run check:rls-registry
npm run check:api-routes
npm run ready-to-deploy   # includes pre-deploy + pre-rollout gates
npm test
```

| Gate | Pass criteria |
|------|----------------|
| Secrets | No `OWNER_SEED_PASSWORD*` on production Worker |
| RLS registry | `npm run check:rls-registry` exit 0 |
| API default-deny | All routes wrapped or intentional bare |
| Health | Manager `GET /api/health` — critical services not error |

---

## 2. Cloudflare production stack

| Binding / secret | Purpose |
|------------------|---------|
| D1 `DB` | Application data |
| R2 `APEX_R2` | Media / video / voice |
| KV `KV_STORE` | Distributed rate limits (not Vercel KV) |
| `DATA_ENCRYPTION_KEY` | AES-GCM PII (optional `DATA_ENCRYPTION_KEY_PREVIOUS` during rotation) |
| `SESSION_SECRET` | Session signing |
| `GROK_API_KEY` | Story / vision / Sophia |
| Twilio vars | Only if `voice_agent` / SMS enabled |

Deploy:

```bash
npm run build
npx wrangler d1 migrations apply merlinus-d1 --remote
npx wrangler deploy
```

---

## 3. First rooftop (pilot)

1. Provision or seed rooftop (commercial provision: **modules off by default** — P1-4).
2. Manager enables contracted modules (Video MPI, Voice, Hub, etc.).
3. Rotate seed/manager passwords; optional `MERLIN_MFA_ENFORCE` for managers.
4. Smoke: login → RO list → story generate → module-off 403 on disabled SKU.
5. Confirm `/api/health` green and `ownerSeedSecrets` ok.

---

## 4. Additional dealerships

1. `provision-dealer` / owner provision API with unique dealer code.
2. Enable modules **per contract** (do not force-enable all SKUs).
3. Branding: dealership name, timezone, story brand pack.
4. Twilio DIDs only if `voice_agent` purchased.
5. Record go-live in support playbook; monitor Sentry + CF observability.

---

## 5. Security posture (honest)

| Claim | Reality |
|-------|---------|
| Multi-tenant isolation | App-layer Prisma RLS on D1 — see [Multi-Tenant-Isolation.md](./Multi-Tenant-Isolation.md) |
| Production readiness | **Conditional pilot / multi-store** after P0 secrets + health + modules |
| MFA | Optional TOTP when `MERLIN_MFA_ENFORCE=true` |
| CSRF | Double-submit cookie + header in production |
| Audit score badges | Do **not** claim 99/100 — use pilot readiness checklists |

---

## 6. Day-2 ops

- **Warmup:** `/api/session/warmup` (auto keep-alive in bay shell)
- **Async AI:** hub summarize / video report with `{ "async": true }` → poll `/api/ai-jobs/:id`
- **Maintenance:** `MERLIN_MAINTENANCE_MODE=true` pauses heavy AI
- **Password recovery (P3-4):** set `MERLIN_PASSWORD_RECOVERY_ENABLED=true` (optional); managers can still reset via Users
- **Voice:** production = Twilio Gather; premium WS only with `VOICE_REALTIME_PREMIUM` + Node sidecar ([realtimeSophia](../src/lib/voiceAgent/realtimeSophia.ts))
- **CDK live sync:** deferred — [CDK-Sync-Deferred.md](./CDK-Sync-Deferred.md)
- **Incidents:** [Support-Playbook.md](./Support-Playbook.md)

---

## 7. Checklist index (legacy → this runbook)

Older docs remain for detail; start here:

1. This runbook (sequence)
2. Production-Readiness-Checklist (sign-off)
3. Product-Modules (SKU matrix)
4. Deployment-Checklist-and-Operations (env tables)
