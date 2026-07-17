# Merlin — Production Deployment Checklist

**Audience:** Dealership IT, Platform maintainer  
**When to use:** Immediately before every production push to Vercel  
**Print:** This page is designed to print cleanly — one checklist per deployment.

---

## Deployment details

| Field | Value |
|-------|-------|
| **Dealership / environment** | _________________________________ |
| **Deployment date** | _________________________________ |
| **Deployer** | _________________________________ |
| **Git commit / branch** | _________________________________ |
| **Vercel project** | _________________________________ |

---

## Pre-deploy validation (required)

- [ ] **Run automated gate** — `npm run ready-to-deploy`  
  - Runs `validate:pre-deploy`, `validate:pre-rollout`, and live rollout probes  
  - Must exit **0** with green **READY** banner

- [ ] **S2 PII dry-run** — `npm run db:migrate-pii-safe`  
  - Preview only — **no database writes**  
  - Review `pendingBeforeRun` / `would update` counts in output  
  - Execute `npm run db:migrate-pii` only during an approved maintenance window (if counts > 0)

- [ ] **Optional live URL probe** — `MERLIN_BASE_URL=https://your-url npm run ready-to-deploy`  
  - Confirms `/api/status` (and `/api/health` when `MERLIN_HEALTH_COOKIE` is set)

---

## Vercel environment (required)

Confirm in **Vercel → Project → Settings → Environment Variables** (Production):

- [ ] `DATABASE_URL` — PostgreSQL connection string (SSL for remote hosts)
- [ ] `DIRECT_URL` — Direct (non-pooled) URL for Prisma migrations
- [ ] `SESSION_SECRET` — min 32 characters
- [ ] `ENCRYPTION_KEY` — min 32 characters (stored in secure vault)
- [ ] `GROK_API_KEY` — server-only; no `NEXT_PUBLIC_*` AI keys
- [ ] **`KV_REST_API_URL`** — Upstash / Vercel KV REST URL (**required for production rate limiting**)
- [ ] **`KV_REST_API_TOKEN`** — KV REST token (**required for production rate limiting**)
- [ ] **`NEXT_PUBLIC_SENTRY_DSN`** — Sentry DSN for client + server error monitoring
- [ ] `BLOB_READ_WRITE_TOKEN` — Vercel Blob for image uploads
- [ ] `NEXT_PUBLIC_APP_URL` — production dealership URL

- [ ] Production build will **fail** without KV — verify both KV variables before push

---

## Recommended maintenance window (when applying DB changes)

Use a short maintenance window if running schema migrations or S2 PII backfill on a live database.

### Before the window

- [ ] Notify service manager and lead technicians of brief read-only period (if needed)
- [ ] Complete database **backup** and verify restore procedure
- [ ] Set `MERLIN_MAINTENANCE_MODE=true` in Vercel Production (optional — pauses AI/uploads)
- [ ] Confirm no technicians are mid-story-generation on active ROs

### During the window

- [ ] `npm run db:migrate:deploy` — apply pending Prisma migrations
- [ ] `npm run db:migrate-pii-safe` — dry-run S2 backfill (review counts)
- [ ] `npm run db:migrate-pii` — execute S2 backfill if dry-run showed pending rows
- [ ] Re-run until `pendingAfterRun` is **0**
- [ ] Deploy application (`git push` to `main` or Vercel promote)
- [ ] `MERLIN_BASE_URL=https://your-url npm run validate:pre-rollout` — post-deploy smoke

### After the window

- [ ] `GET /api/status` → `maintenance: false`, correct `version` / `buildCommit`
- [ ] Spot-check: open RO list, scan flow, generate story on one test line
- [ ] Set `MERLIN_MAINTENANCE_MODE=false` (or remove) when satisfied
- [ ] Monitor Sentry for new errors in the first 30 minutes

---

## Rollback (if needed)

- [ ] Restore database from pre-window backup
- [ ] Revert Vercel deployment to previous production build
- [ ] Do **not** rotate `ENCRYPTION_KEY` without a planned key-migration procedure

---

## Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| IT / Deployer | | | |
| Service Manager (if go-live) | | | |

---

**Quick reference**

```bash
npm run deploy:check          # print this checklist
npm run ready-to-deploy       # full pre-push validation gate
npm run db:migrate-pii-safe   # S2 dry-run (no writes)
```

**Related:** [Rollout Checklist](./Rollout-Checklist.md) · [Go-Live Checklist](./Go-Live-Checklist.md) · [Reencryption Runbook](./Reencryption-Runbook.md)