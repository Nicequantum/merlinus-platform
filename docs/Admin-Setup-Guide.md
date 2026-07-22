# Merlin — Admin & IT Setup Guide

**Audience:** Service Managers, Fixed Ops Directors, Dealership IT  
**Purpose:** Environment setup, validation, monitoring, and secure operations  
**Version:** 3.0.1

---

## Overview

Merlin is a secure, cloud-hosted warranty documentation platform. Each dealership deployment requires:

- A **database** (Cloudflare D1 for Workers production; local SQLite for dev)
- **Server-side secrets** (never exposed to browsers or tablets; never committed)
- **Chrome/Edge tablets** on the shop floor for voice input
- A signed **xAI Data Processing Agreement** before processing real customer data

This guide walks through setup from empty environment to production-ready rollout.

### P0 — National owner seed secrets (Apex)

| Do | Don't |
|----|--------|
| Use `.owner-seed.local.env` (gitignored) for one-time local/remote seed scripts | Commit seed env files or bake passwords into the repo |
| After owners exist: `npx wrangler secret delete OWNER_SEED_PASSWORD` | Leave `OWNER_SEED_PASSWORD` on the production Worker forever |
| Set `APEX_PLATFORM_OWNER_EMAILS` for ongoing operator access | Rely on seed env as long-lived platform allowlist + password store |
| One-shot prod: `ALLOW_OWNER_SEED_BOOTSTRAP=1` then remove | Re-seed on every Worker cold start |

Production health treats lingering owner seed **passwords** as a **critical** failure (`ownerSeedSecrets`). CI runs `npm run check:seed-secrets`.

### MFA (managers & owners)

| Env | Purpose | Default |
|-----|---------|---------|
| `MERLIN_MFA_ENFORCE` | When `true`/`1`, elevated roles must enroll TOTP before PII routes | off (pilot) |
| `MERLIN_MFA_REQUIRED_ROLES` | Comma list: `manager,owner,admin` | those three |
| `ACCESS_TOKEN_TTL_SECONDS` | Apex access cookie TTL | `900` (15 min) |
| `MFA_CHALLENGE_TTL_SECONDS` | Password→MFA pending token TTL | `300` (5 min) |

**Rollout**

1. Apply D1 migration `20250721180000_user_mfa_totp` (UserMfa + backup code columns).
2. Managers open **Settings → Multi-factor authentication**, scan QR, save backup codes.
3. After pilot: set Worker secret `MERLIN_MFA_ENFORCE=true`.
4. Health matrix shows `mfaPolicy` (warn in production when enforce is off).
5. `/manager/jobs` surfaces MFA status for operators.

Bay technicians keep password-only login unless they opt into MFA.

### Manager Control Center

| URL | Purpose |
|-----|---------|
| `/manager/center` | **Default ops landing** — Overview KPIs, AI Jobs, Voice tailoring, Modules, Health |
| `/manager/jobs` | Standalone AI job monitor (retry/cancel) |
| `GET /api/manager/center/summary` | Aggregate snapshot (manager/owner only, dealership-scoped) |

**Tabs:** Overview · AI Jobs · Voice · Modules · Health. Module toggles write `DealershipModule` with audit. Maintenance mode remains **env-only** (`MERLIN_MAINTENANCE_MODE`).

**Live SSE:** `GET /api/manager/center/live` (manager/owner, cookie session). Events: `job:updated`, `health:changed`, `voice:activity`, `modules:changed`, heartbeats every 30s. Max **12** concurrent streams per rooftop (close extra tabs if limited). Tab hidden → connection paused (battery). If SSE fails, UI falls back to soft polling (~45s) and shows **Polling**.

From the classic Manager Dashboard, use **Open Control Center**.

---

## 1. Prerequisites

| Requirement | Detail |
|-------------|--------|
| **Hosting** | Vercel (recommended) or Node.js 20+ server |
| **Database** | PostgreSQL with SSL for remote hosts (`?sslmode=require`) |
| **Repository access** | `Merlinus` main branch |
| **Node.js** | 20 LTS for local validation and migrations |
| **Tablets** | Rugged shop-floor tablets — **Chrome or Edge** (Chromium) |
| **Network** | Stable Wi‑Fi in service bays; voice uses cloud speech recognition |

---

## 2. Environment setup (step by step)

### Step 1 — Clone and install

```bash
git clone https://github.com/Nicequantum/Merlinus.git
cd Merlinus
npm install
```

### Step 2 — Create `.env.local`

Copy the template and fill in dealership-specific values:

```bash
cp .env.example .env.local
```

![Environment file setup](./images/admin-env-local.png)

### Step 3 — Required environment variables

| Variable | Required | How to generate / obtain |
|----------|----------|--------------------------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string. Remote example: `postgresql://USER:PASSWORD@db.prisma.io:5432/postgres?sslmode=require` |
| `SESSION_SECRET` | **Yes** | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | **Yes** | `openssl rand -hex 32` (exactly 64 hex characters for AES-256) |
| `GROK_API_KEY` | For AI | xAI API key — **server only**, never `NEXT_PUBLIC_*` |
| `BLOB_READ_WRITE_TOKEN` | For photos | Vercel Blob read/write token |
| `KV_REST_API_URL` | Production | Upstash/Vercel KV URL for distributed rate limiting |
| `KV_REST_API_TOKEN` | Production | KV REST token |
| `NEXT_PUBLIC_APP_URL` | Production | Public dealership URL (e.g. `https://merlin.yourdealer.com`) |
| `MERLIN_MAINTENANCE_MODE` | Optional | `true` during maintenance windows |
| `ADMIN_SEED_PASSWORD` | Seed only | Strong manager password for initial `db:seed` — rotate after first login |

**Security rules:**

- Never commit `.env.local` or real secrets to git.
- Never set `NEXT_PUBLIC_GROK_API_KEY` or `NEXT_PUBLIC_XAI_API_KEY`.
- Rotate seed passwords via Merlin **Settings** before technicians use the system.

### Step 4 — Database migration

```bash
npm run db:migrate:deploy
```

For a fresh dealership:

```bash
npm run db:seed
```

Sign in as the seeded manager account and **change all default passwords immediately**.

### Step 5 — Legacy data re-encryption (upgrades only)

If upgrading an existing database with older plaintext columns:

```bash
npm run db:reencrypt
```

Safe to run multiple times — already-encrypted rows are skipped.

### Step 6 — Validate environment

```bash
npm run validate:env
```

Runs automatically during `npm run build`. Fails the build if required variables are missing or malformed.

### Step 7 — Production deploy (Vercel)

1. Connect the repository to Vercel.
2. Set **all** variables from `.env.example` in Vercel Project → Settings → Environment Variables.
3. Deploy `main` — build runs `validate:env`, `prisma migrate deploy`, and Next.js build.
4. Confirm the deployed URL loads the login screen.

![Vercel environment variables](./images/admin-vercel-env.png)

---

## 3. Pre-rollout validation

Run the full validation suite **after every production config change** and **before handing tablets to technicians**.

### Basic run (local / staging credentials)

```bash
npm run validate:pre-rollout
```

Uses `.env.local` at the repo root. The script:

- Loads `.env` → `.env.local` (overrides) → `.env.production`
- Normalizes `DATABASE_URL` (`postgres://` → `postgresql://`, adds `sslmode=require` for remote hosts)
- Connects with a dedicated Prisma client and runs `SELECT 1`
- Prints the target hostname **without credentials**

### Live deployment probe

```bash
MERLIN_BASE_URL=https://your-dealership-url.example npm run validate:pre-rollout
```

Adds a live `GET /api/health` check against the deployed instance.

### Reading results

| Symbol | Meaning | Action |
|--------|---------|--------|
| **✔ PASS** (green) | Check succeeded | None |
| **⚠ WARN** (yellow) | Non-blocking issue (e.g. KV not configured) | Review; document if acceptable |
| **✖ FAIL** (red) | Critical check failed | **Block rollout** until fixed |

Exit code **1** means critical failures — do not go live.

### Common validation failures

| Failure | Fix |
|---------|-----|
| Database connection to `localhost` | Update `DATABASE_URL` in `.env.local` / Vercel to remote production host |
| Missing `ENCRYPTION_KEY` or `SESSION_SECRET` | Generate and set in environment |
| `MERLIN_MAINTENANCE_MODE` enabled | Set to `false` or remove before rollout |
| CSP / auth audit failures | Escalate to platform maintainer — do not patch in production ad hoc |

![Pre-rollout validation report](./images/admin-pre-rollout-report.png)

### Manual steps after the script passes

The automated suite cannot replace shop-floor verification:

- [ ] Voice + microphone on a physical bay tablet
- [ ] End-to-end story generation on a real RO
- [ ] PDF download on tablet viewport
- [ ] CDK paste workflow with a service manager

---

## 4. Maintenance mode

Use maintenance mode during database migrations, encryption work, or emergency pauses.

### Enable

Set in Vercel (or `.env.local` for staging):

```env
MERLIN_MAINTENANCE_MODE=true
```

Redeploy or restart the application.

### What technicians see

- A friendly **maintenance banner** at the top of the app
- **AI routes blocked** (story generation and review return 503)
- Login, viewing ROs, and **manual typing** still work

### What stays available

| Endpoint / feature | Available during maintenance? |
|--------------------|-------------------------------|
| `GET /api/health` | Yes |
| `GET /api/status` | Yes |
| Login / logout | Yes |
| Manual note entry | Yes |
| AI generation / review | **No** |

### Disable

```env
MERLIN_MAINTENANCE_MODE=false
```

Or remove the variable entirely. Redeploy, then confirm:

```bash
curl -s https://your-dealership-url/api/status | jq '.maintenance'
# Expected: false
```

Pre-rollout validation **fails** if maintenance mode is on — this is intentional.

---

## 5. System health monitoring

### Health endpoint (IT monitoring)

```bash
curl -s https://your-dealership-url/api/health
```

**Key fields:**

| Field | Healthy value | Notes |
|-------|---------------|-------|
| `status` | `"ok"` | `"degraded"` = warnings present; `"error"` = 503 response |
| `services.database` | `"ok"` | PostgreSQL reachable |
| `services.grok` | `"ok"` | `GROK_API_KEY` configured |
| `services.voice` | `"ok"` | Voice enabled in dealership config |
| `services.kv` | `"ok"` | Distributed rate limiting active |
| `services.maintenance` | `"ok"` | Maintenance mode off |
| `version` / `buildCommit` / `buildDate` | Populated | Shown in app footer for support calls |

### Status endpoint (lightweight)

```bash
curl -s https://your-dealership-url/api/status
```

Returns `maintenance`, `version`, `promptVersion`, and `voiceEnabled` — suitable for uptime dashboards. AI configuration is checked on authenticated `/api/health` (manager-only).

### Recommended monitoring

| Check | Frequency | Alert if |
|-------|-----------|----------|
| `/api/health` → `status` | Every 5 minutes | `"error"` for 2+ consecutive checks |
| `/api/health` → `services.database` | Every 5 minutes | Not `"ok"` |
| SSL certificate expiry | Weekly | < 14 days remaining |
| Pre-rollout validation | After each deploy | Any critical FAIL |

![Health endpoint response](./images/admin-health-endpoint.png)

### UI footer verification

On a signed-in tablet, confirm the footer shows **version**, **git commit**, and **build date**. Technicians can read these to IT during support calls.

---

## 6. Encryption key management

### Initial setup

Generate once per dealership deployment:

```bash
openssl rand -hex 32
```

Set as `ENCRYPTION_KEY` in Vercel. Merlin uses **AES-256-GCM** for customer names, VINs, complaints, technician notes, diagnostic data, and warranty stories at rest.

### Critical warning — key rotation

**Changing `DATA_ENCRYPTION_KEY` without a dual-key window (or re-encrypt) makes stored repair orders unreadable.**

Rotation is a **planned ops event**, but Merlin supports **zero-downtime dual-key** decrypt during the re-encrypt pass.

### Encryption key rotation procedure (dual-key)

| Step | Action | Owner |
|------|--------|-------|
| 1 | Full database backup (snapshot + verify restore) | IT |
| 2 | Settings → Security → **Encryption key rotation** → **Begin rotation** — copy one-time new key | Service Manager + IT |
| 3 | Set secrets: `DATA_ENCRYPTION_KEY_PREVIOUS=<old>`, `DATA_ENCRYPTION_KEY=<new>` | IT |
| 4 | Deploy/restart Worker so dual-key is live | IT |
| 5 | **Start re-encryption** in UI (or `npm run db:reencrypt` with dual-key env) | IT |
| 6 | Watch progress to 100%; health may warn while dual-key is active | IT |
| 7 | Spot-check historical ROs — VIN, notes, stories decrypt correctly | Service Manager |
| 8 | Remove `DATA_ENCRYPTION_KEY_PREVIOUS`; redeploy | IT |
| 9 | Run `npm run validate:pre-rollout` | IT |

Recommend rotation every **90 days** or after suspected key exposure. Full runbook: [Reencryption-Runbook.md](./Reencryption-Runbook.md).

> **Note:** `npm run db:reencrypt` also migrates **legacy plaintext** to encrypted format. Prefer the in-app rotation panel for AES key rollover.

### Fresh deployment (no production data yet)

If no repair orders exist, simply set a new `ENCRYPTION_KEY` before go-live. Rotation complexity applies only after customer data is stored.

---

## 7. Voice configuration (per dealership)

Voice defaults are tuned for noisy Mercedes-Benz service bays. IT or your deployment engineer can adjust `src/lib/voice/voiceSettings.ts` before build:

| Setting | Default | Purpose |
|---------|---------|---------|
| `enabled` | `true` | Master switch — `false` hides all mic buttons |
| `pushToTalkDefault` | `false` | Default to tap-to-toggle; set `true` for loud bays |
| `listeningTimeoutMs` | `15000` | Auto-stop after silence |
| `language` | `en-US` | Speech recognition language |

Changes require redeploy. Technicians can override push-to-talk vs tap-to-toggle per tablet (saved in browser storage).

---

## 8. Security checklist (admin sign-off)

- [ ] All secrets in Vercel — not in source code or tablets
- [ ] Seed / default passwords rotated via Settings
- [ ] xAI DPA executed and filed
- [ ] Audit log shows **VALID** chain integrity
- [ ] No `NEXT_PUBLIC_*` AI keys
- [ ] CSP headers verified (no console violations on login + line view)
- [ ] Microphone permission tested on shop-floor tablet
- [ ] IT contact and escalation path documented for technicians

---

## 9. Support escalation

| Severity | Example | Response |
|----------|---------|----------|
| **P1 — Stop work** | Audit chain integrity error, widespread login failure | Enable maintenance mode; notify Fixed Ops leadership |
| **P2 — Degraded** | AI timeouts, single tablet voice failure | Service manager coordinates; IT checks `/api/health` |
| **P3 — Question** | Template library, training | Service manager / trainer |

---

## Quick reference commands

```bash
npm run validate:env          # Required variables
npm run validate:pre-rollout  # Full pre-rollout suite
npm run db:migrate:deploy     # Apply database migrations
npm run db:seed               # Initial accounts (fresh install)
npm run db:reencrypt          # Legacy plaintext → encrypted
npm run build                 # Production build (includes validation)
```

---

*Merlin — Mercedes-Benz Warranty Story Generator · Admin Setup Guide*