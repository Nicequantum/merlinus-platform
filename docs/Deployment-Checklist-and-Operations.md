# Merlinus — Deployment Checklist & Operations

**Version:** 3.0.0  
**Audience:** Dealership IT, platform operations, deploy engineers  
**When to use:** Before every production deployment and after any environment change

---

## 1. Deployment overview

| Field | Value |
|-------|-------|
| **Target platform** | Vercel + PostgreSQL (Neon, Vercel Postgres, Supabase, or Prisma-hosted) |
| **Repository** | [github.com/Nicequantum/Merlinus](https://github.com/Nicequantum/Merlinus) |
| **Branch** | `main` |
| **Automated gate** | `npm run ready-to-deploy` — must exit **0** |

---

## 2. Local development setup

```bash
git clone https://github.com/Nicequantum/Merlinus.git
cd Merlinus
npm install
cp .env.example .env.local
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) after configuring environment variables.

**Seed login:** D7 `D7HARRIH` (service manager) — password from `ADMIN_SEED_PASSWORD` in `.env.local`. First-login password rotation enforced via Settings before production go-live.

---

## 3. Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DIRECT_URL` | Production | Direct (non-pooled) URL for Prisma migrations |
| `SESSION_SECRET` | Yes | Session signing key (`openssl rand -base64 32`) |
| `DATA_ENCRYPTION_KEY` | Yes | AES-256-GCM key — 64 hex chars (`openssl rand -hex 32`) |
| `SEARCH_HMAC_KEY` | Yes | HMAC key for RO blind-index — 64 hex chars, must differ from encryption key |
| `GROK_API_KEY` | For AI | xAI API key (server-side only) |
| `BLOB_READ_WRITE_TOKEN` | For uploads | Private diagnostic image storage |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | **Production required** | Distributed rate limiting (auth multi-instance). Connect Vercel KV; missing → `rate_limit.auth_kv_required` / boot `rate_limit.production_kv_missing` |
| `NEXT_PUBLIC_SENTRY_DSN` | Production | Sentry error monitoring |
| `NEXT_PUBLIC_APP_URL` | Yes | Production dealership URL |
| `DEALERSHIP_DISPLAY_NAME` | Per site | PDF headers and UI branding |
| `MERLIN_MAINTENANCE_MODE` | Optional | `true` pauses AI routes during maintenance |
| `ADMIN_SEED_PASSWORD` / `TECH_SEED_PASSWORD` | For seed | Set in `.env.local` only; rotate before go-live — **never** leave on production Worker |
| `OWNER_SEED_PASSWORD` / `OWNER_SEED_PASSWORD_2` | **One-time bootstrap only** | Prefer `.owner-seed.local.env` (gitignored) + `scripts/seed-owner-d1-remote.mjs`. Production Worker: set only with `ALLOW_OWNER_SEED_BOOTSTRAP=1`, then **delete** secrets. Health **fails** if passwords remain without the flag. |
| `ALLOW_OWNER_SEED_BOOTSTRAP` | One-shot | `1` / `true` only during first owner create on production; remove after seed |
| `APEX_PLATFORM_OWNER_EMAILS` | Production owners | Ongoing national operator allowlist (after seed passwords deleted) |

Build-time validation runs automatically via `npm run validate:env` (included in `npm run build`).

### P0 — Owner seed secrets (must pass before multi-rooftop traffic)

1. **Never commit** `.owner-seed.local.env` or `*seed*.local.env` (gitignored; `npm run check:seed-secrets` in CI).
2. Bootstrap national owners **once** (local script or one deploy with `ALLOW_OWNER_SEED_BOOTSTRAP=1`).
3. Immediately delete from Cloudflare:
   ```bash
   npx wrangler secret delete OWNER_SEED_PASSWORD
   npx wrangler secret delete OWNER_SEED_PASSWORD_2   # if used
   npx wrangler secret delete MULTI_ROOFTOP_SEED_PASSWORD  # if used
   # also remove ALLOW_OWNER_SEED_BOOTSTRAP variable
   ```
4. Set `APEX_PLATFORM_OWNER_EMAILS` for ongoing platform operator access.
5. Confirm manager `/api/health` shows `ownerSeedSecrets: ok` (critical in production — 503 if passwords still set).
6. `npm run ready-to-deploy` runs `check:seed-secrets` + pre-deploy owner-seed gate.

### P0-5 — RLS tenant model registry

App-layer isolation depends on every rooftop model being listed in `src/lib/apex/rlsTenantRegistry.ts`:

| Schema shape | Registry |
|--------------|----------|
| Has `dealershipId` | `DIRECT_DEALERSHIP_MODELS` |
| Child of tenant row (no `dealershipId`) | `RELATION_SCOPED_MODELS` (parent relation field) |
| Platform / hierarchy only | `PLATFORM_NON_TENANT_MODELS` |

```bash
npm run check:rls-registry   # must exit 0 before deploy
```

`ready-to-deploy` and CI run this check. PR template includes the registry checklist when schema changes.

### P0-4 — API default-deny

```bash
npm run check:api-routes   # every route uses withAuth / withPublicRoute / withStoryAiRoute or intentional bare allowlist
```

### P0-3 — Production health (manager)

After deploy, sign in as manager and GET `/api/health`:

- Critical (`503` if error in production): `database`, `kv`, `ownerSeedSecrets`
- Module-aware: `twilioVoice` errors when `voice_agent` enabled without Twilio credentials
- Payload includes `modules` / `modulesEnabled` for the active rooftop

---

## 4. Pre-rollout validation

Run the full validation suite **after build, before go-live** — and again after any production config change.

```bash
# Local / staging (uses .env.local + in-process health checks)
npm run validate:pre-rollout

# Against a deployed instance (adds live /api/health probe)
MERLIN_BASE_URL=https://your-dealership-url.example npm run validate:pre-rollout

# Full production deploy gate
npm run ready-to-deploy
```

| When to run | Who |
|-------------|-----|
| After `npm run build` succeeds on release candidate | Dealership IT / deploy engineer |
| After setting Vercel environment variables | Dealership IT |
| After database migration on production | Dealership IT |
| Before handing tablets to technicians | Service manager + IT sign-off |

### What validation covers

- Environment variables, maintenance mode off, build metadata
- Database connectivity, encryption round-trip, audit chain integrity
- Prompt version alignment (app v3.0.0 / prompt v3.0.0)
- PDF generation, voice configuration, prompt assembly, rate limits
- CSP headers, Grok route rate limiting, route authentication (46 routes)
- Health checks (in-process; optional live `/api/health` via `MERLIN_BASE_URL`)

### Manual steps after automated pass

- Shop-floor tablet voice/mic test
- End-to-end story generation with a real RO
- PDF download on tablet viewport

---

## 5. Vercel KV setup (production)

Distributed rate limiting requires **Vercel KV** (Upstash Redis). Without it, limits are per serverless instance only.

1. Vercel dashboard: **Project → Storage → Create Database → KV**
2. Name the store (e.g. `merlin-kv`) and **Connect to Project** — select Production (and Preview if desired)
3. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically
4. Redeploy so running instances pick up new variables
5. Re-run `npm run validate:pre-rollout` — **Distributed rate limiting (KV)** should show PASS

Non-Vercel hosting: create an [Upstash Redis](https://upstash.com/) database and copy REST URL and token into environment variables.

---

## 6. Production deployment (Vercel + PostgreSQL)

1. Connect repository; deploy branch `main`
2. Set all variables from `.env.example` in Vercel project settings (including KV)
3. Confirm `npm run build` succeeds (runs env validation + `prisma migrate deploy`)
4. Run `npm run db:reencrypt` if upgrading an existing database
5. Verify health and status endpoints:

```bash
curl -s https://your-dealership-url/api/health | jq '.status, .services'
curl -s https://your-dealership-url/api/status | jq '.version, .buildCommit, .maintenance'
```

6. Confirm UI footer shows version, commit hash, and build date on a signed-in tablet

---

## 7. Pre-production checklist

### Infrastructure

- [ ] Pre-rollout validation passes (`npm run validate:pre-rollout`)
- [ ] `DATABASE_URL`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_HMAC_KEY` set and validated
- [ ] `GROK_API_KEY` configured server-side (no `NEXT_PUBLIC_*` xAI keys)
- [ ] `KV_REST_API_URL` + `KV_REST_API_TOKEN` set for distributed rate limiting
- [ ] `BLOB_READ_WRITE_TOKEN` set for diagnostic image uploads
- [ ] `NEXT_PUBLIC_SENTRY_DSN` configured
- [ ] Database migrations applied (`npm run db:migrate:deploy`)
- [ ] Legacy data re-encrypted (`npm run db:reencrypt`) if upgrading

### Security & compliance

- [ ] Seed/default passwords rotated via Settings
- [ ] Audit log hash-chain integrity shows **VALID**
- [ ] xAI Data Processing Agreement executed
- [ ] CSP/security headers verified (no console CSP violations on login + line view)
- [ ] Microphone permission tested on shop-floor tablet (Chrome/Edge)

### Operational readiness

- [ ] `GET /api/health` returns `"status": "ok"` or acceptable `"degraded"`
- [ ] `services.database`, `services.grok`, `services.voice` reported in health payload
- [ ] Story generation + PDF export tested end-to-end on tablet viewport
- [ ] Offline banner appears when Wi‑Fi disabled; manual typing still works
- [ ] `MERLIN_MAINTENANCE_MODE` tested — banner shows, AI routes return 503
- [ ] CI unit tests passing on `main` (`npm test`)
- [ ] Error boundary tested (force client error — recovery UI appears)

### Rollout

- [ ] Service manager briefed on audit log and usage dashboard
- [ ] Technicians briefed on voice push-to-talk and manual fallback
- [ ] IT contact documented for health endpoint monitoring

---

## 8. Maintenance window procedures

Use a short maintenance window when applying schema migrations or S2 PII backfill on a live database.

### Before the window

- [ ] Notify service manager and lead technicians
- [ ] Complete database **backup** and verify restore procedure
- [ ] Set `MERLIN_MAINTENANCE_MODE=true` in Vercel Production (optional)
- [ ] Confirm no technicians are mid-story-generation on active ROs

### During the window

- [ ] `npm run db:migrate:deploy` — apply pending Prisma migrations
- [ ] `npm run db:migrate-pii-safe` — dry-run S2 backfill (review counts)
- [ ] `npm run db:migrate-pii` — execute S2 backfill if dry-run showed pending rows
- [ ] Deploy application (`git push` to `main` or Vercel promote)
- [ ] `MERLIN_BASE_URL=https://your-url npm run validate:pre-rollout` — post-deploy smoke

### After the window

- [ ] `GET /api/status` → `maintenance: false`, correct `version` / `buildCommit`
- [ ] Spot-check: open RO list, scan flow, generate story on one test line
- [ ] Set `MERLIN_MAINTENANCE_MODE=false` when satisfied

---

## 9. Rollout document library

| Audience | Primary document |
|----------|------------------|
| **GM / Fixed Ops Director** | [Master Rollout Document](./Master-Rollout-Document.md) |
| **Service Manager** | [Rollout Checklist](./Rollout-Checklist.md) |
| **Dealership IT** | [Admin Setup Guide](./Admin-Setup-Guide.md) |
| **Trainer** | [Training Outline](./Training-Outline.md) |
| **Technician** | [Bay Reference Card](./Bay-Reference-Card.md) + [Quick Start](./Technician-Quick-Start.md) |

### Rollout sequence

1. Leadership approves via [Master Rollout Document](./Master-Rollout-Document.md)
2. IT provisions per [Admin Setup Guide](./Admin-Setup-Guide.md) → passes `npm run validate:pre-rollout`
3. Service manager completes [Rollout Checklist](./Rollout-Checklist.md) Phase 1
4. Final [Go-Live Checklist](./Go-Live-Checklist.md) 24–48 hours before launch
5. Go-live: training + [Bay Reference Cards](./Bay-Reference-Card.md) at every tablet
6. Post-launch: [Support Playbook](./Support-Playbook.md) + 30/60/90-day metrics

---

## 10. Related documents

| Document | Purpose |
|----------|---------|
| [DEPLOYMENT-CHECKLIST.md](./DEPLOYMENT-CHECKLIST.md) | Printable per-deployment checklist |
| [Production Readiness Checklist](./Production-Readiness-Checklist.md) | Mandatory sign-off form |
| [Reencryption Runbook](./Reencryption-Runbook.md) | Key rotation procedures |
| [Support Playbook](./Support-Playbook.md) | Incident response and escalation |