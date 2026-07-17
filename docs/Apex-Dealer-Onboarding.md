# Apex Dealer Onboarding — Secure Provisioning Guide

**Audience:** Platform operators provisioning new franchise dealers and rooftops  
**Prerequisites:** Apex national platform (Phase 5) + Security Fortress + Hardening Sprint (6.0–6.5) + Enterprise Cleanup (7.1–7.3, complete)  
**Status:** Complete (PR-P1 engine/CLI · PR-P2 docs/UI · PR-P3 HTTP API · PR-P4 finalize)

Related:

- [Apex-National-Platform.md](./Apex-National-Platform.md) — modes, owners, fortress overview  
- [Security-Fortress.md](./Security-Fortress.md) — RLS, audits, session revocation, provision controls  
- [Admin-Setup-Guide.md](./Admin-Setup-Guide.md) — env / migrations for Merlinus pilot  

**Pre-rollout gate:** `npm run validate:pre-rollout` includes section **APEX Dealer Provision** (code artifacts). Config-only failures (e.g. DB host unreachable) are reported separately from repository defects. 

---

## What “onboarding a dealer” means

One **secure CLI provision** creates, in a single RLS-bypass transaction:

| Entity | Meaning | CLI / UI name |
|--------|---------|----------------|
| **Dealer** | Franchise / legal brand group | `--dealer-name`, `--code` |
| **Dealership** | Physical rooftop (storefront) | `--rooftop-name` → **UI display name** |
| **Service manager** | First admin user for that rooftop | `--manager-*` |

There is **no nickname / short label in v1**. The full storefront string is what owners and staff see in the national list and dealership header (example: `Mercedes-Benz of Newport`).

Seed / pilot rooftops (`seed-dealership`, `__apex_national__`, Tiverton pilot labels) are **deny-listed** and cannot be provision targets.

---

## Security model (non-negotiable)

1. **Passwords never on argv**  
   CLI rejects `--manager-password`, `--password`, and similar flags. Use:
   - `--manager-password-env=VAR` (recommended for automation)
   - `--password-stdin`
   - interactive hidden prompt (TTY)
   - `--generate-password` + optional `--show-credentials` (stderr only)

2. **Forced password change**  
   New managers are created with `mustChangePassword: true`.  
   Until they rotate via `POST /api/auth/change-password`, PII and workspace APIs return `403` with `code: PASSWORD_CHANGE_REQUIRED`.  
   Allowed while forced: login, session probe (`/api/auth/me`), change-password, logout.

3. **PII-free provision audit**  
   Action `dealer.provision` metadata is allow-listed only (`templateId`, hashes, ids, outcome — **no** rooftop name, email, D7, or password).

4. **Production guard**  
   Production requires `PROVISION_DATABASE_URL` (narrow DB role) **or** explicit break-glass `APEX_PROVISION_ALLOW_APP_DB=1`.

5. **Rate / scale caps**  
   - `APEX_MAX_PROVISIONS_PER_DAY` (default **20**)  
   - `APEX_MAX_DEALERSHIPS` (default **500**, excluding deny-list ids)

6. **Confirm before write**  
   Interactive confirm must retype the dealer code. Non-interactive: `--yes` **and** `APEX_PROVISION_ALLOW_YES=1`.

---

## Naming rules

| Flag | Maps to | Rules |
|------|---------|--------|
| `--code` | `Dealer.code` | 2–32 chars, normalized `A-Z0-9_-`. Reserved: `NATIONAL`, `MERLINUS`, `SEED`, `TIVERTON`, `APEX`, `ADMIN`, `TEST` |
| `--dealer-name` | `Dealer.name` | Franchise label, 3–120 chars |
| `--rooftop-name` | `Dealership.name` | **Full storefront**, 5–120 chars; not equal to code alone; rejects placeholders (`merlinus`, `seed-dealership`, pilot Tiverton names, etc.) |

**Examples**

```text
--code=NEWPORT
--dealer-name="Mercedes-Benz of Newport Group"
--rooftop-name="Mercedes-Benz of Newport"
```

---

## Templates

Templates control **login strategy, feature defaults, and branding chrome** — **never** display names or logos from the Merlinus pilot.

| Template id | Extends | Brand | Manager login | Branding | Notes |
|-------------|---------|-------|---------------|----------|--------|
| `base-rooftop-v1` | — | none | **Email** | No logo, neutral theme | Clean empty starting point |
| `mercedes-rooftop-v1` | `base-rooftop-v1` | mercedes | **D7** (`--manager-d7`) | Mercedes logo/theme metadata | Adds Xentry + D7 only |
| `generic-rooftop-v1` | `base-rooftop-v1` | generic | **Apex username** (`--manager-username`) | No logo, neutral | Multi-brand rooftops |

Source: [`src/lib/apex/dealerTemplates.ts`](../src/lib/apex/dealerTemplates.ts).

**Invariants**

- `--rooftop-name` → `Dealership.name` (UI header / national list) — **only** source of storefront label  
- `--dealer-name` → `Dealer.name` — **only** source of franchise label  
- Templates set `branding.hardcodedDisplayName: null` and `seed.copyPilotDealership: false`  
- Pilot labels (`Merlinus`, bare `Tiverton`, `Mercedes-Benz of Tiverton`, `VITI`) are rejected at provision time  
- UI chrome uses **session** `dealershipName`, not env `DEALERSHIP_DISPLAY_NAME` (Tiverton pilot default)

Seed policy: **no pilot clone** — does not copy Tiverton/Merlinus dealership rows, logos, or user templates.

---

## Prerequisites

1. Apex DB reachable (local: `.env.apex.local` / `npm run dev:apex` env pattern).  
2. Migrations applied (includes `must_change_password` on `Technician`).  
3. Platform mode for the app: `PLATFORM_MODE=apex` + `NEXT_PUBLIC_PLATFORM_MODE=apex`.  
4. Operator machine has repo checkout and `npm install`.  
5. Manager password ready (≥ **12** chars for provision policy; not a weak dictionary string).

CLI auto-loads `.env.local` then `.env.apex.local`, and sets `APEX_ENV` / `PLATFORM_MODE` defaults for the provision process.

---

## CLI usage

```bash
npm run provision-dealer -- --help
```

### Dry-run (no writes)

```bash
npm run provision-dealer -- \
  --code=NEWPORT \
  --dealer-name="Mercedes-Benz of Newport Group" \
  --rooftop-name="Mercedes-Benz of Newport" \
  --template=mercedes-rooftop-v1 \
  --manager-name="Alex Rivera" \
  --manager-email=alex.rivera@example-dealer.com \
  --manager-d7=D7NEWPORT1 \
  --dry-run
```

### Mercedes rooftop (recommended interactive)

```bash
# Put temp password in env — never on the command line
export NEWPORT_MANAGER_PASSWORD='your-temp-password-here'

npm run provision-dealer -- \
  --code=NEWPORT \
  --dealer-name="Mercedes-Benz of Newport Group" \
  --rooftop-name="Mercedes-Benz of Newport" \
  --template=mercedes-rooftop-v1 \
  --manager-name="Alex Rivera" \
  --manager-email=alex.rivera@example-dealer.com \
  --manager-d7=D7NEWPORT1 \
  --manager-password-env=NEWPORT_MANAGER_PASSWORD \
  --show-credentials
```

Confirm by typing the dealer code when prompted.

### Clean base rooftop (no brand / no logo)

```bash
npm run provision-dealer -- \
  --code=METRO01 \
  --dealer-name="Metro Auto Group" \
  --rooftop-name="Metro Auto Downtown" \
  --template=base-rooftop-v1 \
  --manager-name="Sam Lee" \
  --manager-email=sam.lee@example-dealer.com \
  --generate-password \
  --show-credentials
```

Manager signs in with **email** + temporary password (no D7 / username).

### Generic multi-brand rooftop

```bash
npm run provision-dealer -- \
  --code=METRO01 \
  --dealer-name="Metro Auto Group" \
  --rooftop-name="Metro Auto Downtown" \
  --template=generic-rooftop-v1 \
  --manager-name="Sam Lee" \
  --manager-email=sam.lee@example-dealer.com \
  --manager-username=metro.sam.lee \
  --generate-password \
  --show-credentials
```

### Idempotency (`--if-exists`)

| Mode | Behavior |
|------|----------|
| `fail` (default) | Error if dealer code already exists |
| `skip` | No-op success when dealer exists |
| `update-metadata` | Limited metadata path for existing dealer (see engine) |

### Automation / CI

```bash
export APEX_PROVISION_ALLOW_YES=1
export NEWPORT_MANAGER_PASSWORD='…'

npm run provision-dealer -- \
  --code=NEWPORT \
  …flags… \
  --manager-password-env=NEWPORT_MANAGER_PASSWORD \
  --yes \
  --json
```

`--json` prints a **safe** summary (no password). Use `--show-credentials` for stderr credential lines when needed.

---

## First login (forced password change)

1. Open Apex app (`PLATFORM_MODE=apex`).  
2. Manager signs in with **D7** or **username** (per template) + temporary password.  
3. UI shows the **forced password change** screen (`ForcedPasswordChangeScreen`) — workspace, national console, and PII APIs are blocked.  
4. Enter temporary password → new password (min 8 for API; use a strong personal password) → confirm.  
5. On success: sessions are **fully revoked** (JWT version + apex refresh + Clerk if linked); cookies cleared.  
6. Sign in again with the **new** password → normal consent/legal gates (if any) → rooftop workspace.

Optional Settings “Change Password” remains available after the forced gate is cleared.

---

## Operator handoff checklist

- [ ] Store temporary password only in a password manager (or `--generate-password` + immediate handoff).  
- [ ] Share **login identifier** (D7 / username) + temp password via secure channel — not email plaintext if avoidable.  
- [ ] Tell manager they **must** change password on first login before any RO work.  
- [ ] National owner can confirm rooftop appears with the full `--rooftop-name` in national dealership list.  
- [ ] After first login, verify manager can create users / use bay tools for that rooftop only.  
- [ ] Clear shell history / unset `*_MANAGER_PASSWORD` env vars on the operator machine.

---

## Smoke test verification steps

Run these after deploy or before first production rooftop.

### Automated smoke script (preferred first pass)

```bash
# Static gates + CLI password-argv rejection
npm run smoke:dealer-provision

# Also run dry-run provision against configured DB (no writes)
npm run smoke:dealer-provision -- --dry-run-db

# Optional one-shot live create (staging only)
APEX_SMOKE_LIVE=1 npm run smoke:dealer-provision -- --live
```

Script: [`scripts/smoke-dealer-provision.ts`](../scripts/smoke-dealer-provision.ts)

### A. Unit / static

```bash
npm run typecheck
npm test -- tests/unit/provisionDealer.test.ts
npm run test:integration -- tests/integration/dealer-provision.test.ts
npm run validate:pre-rollout
```

Expect: template list, naming validators, CLI forbids password argv patterns, audit metadata allow-list, pre-rollout **APEX Dealer Provision** section all PASS.

### B. Dry-run provision

```bash
npm run provision-dealer -- \
  --code=SMOKETEST \
  --dealer-name="Smoke Test Franchise" \
  --rooftop-name="Smoke Test Motors of Riverside" \
  --template=mercedes-rooftop-v1 \
  --manager-name="Smoke Manager" \
  --manager-email=smoke.manager@example.com \
  --manager-d7=D7SMOKE01 \
  --dry-run
```

Expect: `Dry-run OK.` and `mustChangePassword: true` without DB writes.

### C. Live provision (staging / local Apex DB only)

```bash
export SMOKE_MGR_PASSWORD='SmokeTest-Temp-Pass-9x'
npm run provision-dealer -- \
  --code=SMOKETEST \
  --dealer-name="Smoke Test Franchise" \
  --rooftop-name="Smoke Test Motors of Riverside" \
  --template=mercedes-rooftop-v1 \
  --manager-name="Smoke Manager" \
  --manager-email=smoke.manager@example.com \
  --manager-d7=D7SMOKE01 \
  --manager-password-env=SMOKE_MGR_PASSWORD \
  --show-credentials
```

Expect:

- Console: `Provision succeeded.` + ids  
- stderr credentials (if `--show-credentials`)  
- Audit row `dealer.provision` with hashed code / no PII in metadata  

### D. Forced password gate (UI)

1. `npm run dev:apex` (or staging URL with Apex mode).  
2. Login as `D7SMOKE01` + temp password.  
3. **Must** see forced password screen (`data-testid="forced-password-change"`).  
4. Attempt any PII route (e.g. list ROs) via UI → blocked until change.  
5. Complete password change → signed out → login with new password → workspace loads.

### E. API-level gate

With session cookie while `mustChangePassword` is still true:

```http
GET /api/repair-orders
→ 403 { "code": "PASSWORD_CHANGE_REQUIRED", ... }
```

```http
POST /api/auth/change-password
→ 200 { "ok": true, "requiresReauth": true }
```

### F. Owner national visibility

1. Login as national owner (email).  
2. Confirm new rooftop display name matches `--rooftop-name`.  
3. Enter dealership → scoped PII for that rooftop only → exit national.

### G. Negative security checks

| Check | Expect |
|-------|--------|
| `npm run provision-dealer -- --manager-password=secret …` | Exit 2, security error |
| Rooftop name `Tiverton` / `seed-dealership` | `FORBIDDEN_ROOFTOP_NAME` |
| Code `NATIONAL` | `RESERVED_DEALER_CODE` |
| Second provision same code default | fail / exists error |
| `--yes` without `APEX_PROVISION_ALLOW_YES=1` | error |

---

## Environment reference

| Variable | Purpose |
|----------|---------|
| `PLATFORM_MODE` / `NEXT_PUBLIC_PLATFORM_MODE` | `apex` for national + multi-rooftop |
| `PROVISION_DATABASE_URL` | Production provision connection (preferred) |
| `APEX_PROVISION_ALLOW_APP_DB` | Break-glass: allow app DB URL in production |
| `APEX_PROVISION_ALLOW_YES` | Required with `--yes` |
| `APEX_MAX_PROVISIONS_PER_DAY` | Daily cap (default 20) |
| `APEX_MAX_DEALERSHIPS` | Hard cap (default 500) |
| `PROVISION_AUDIT_HMAC_KEY` | Optional; else falls back to search/data encryption key for code hash |
| `APEX_ALLOW_HTTP_PROVISION` | Must be exactly `true` to enable `POST /api/owner/provision-dealer` (default off) |

---

## HTTP provision (optional owner API)

**Endpoint:** `POST /api/owner/provision-dealer`  
**Default:** **disabled**. Enable only when needed:

```env
APEX_ALLOW_HTTP_PROVISION=true
```

### Fortress guards

| Guard | Behavior |
|-------|----------|
| Platform | Apex mode only (`404` otherwise) |
| Feature flag | `APEX_ALLOW_HTTP_PROVISION=true` or `403` + `HTTP_PROVISION_DISABLED` |
| Auth | Owner session + **national** scope (`requireOwnerNational`) |
| Rate limit | 5 req / 60s per IP (`owner.provision-dealer`) |
| Confirmation | Body `confirmDealerCode` must match `dealerCode` (case-insensitive) |
| Production DB | Same `PROVISION_DATABASE_URL` / break-glass rule as CLI |
| Core engine | Same `provisionDealer()` — RLS bypass tx + fail-closed `dealer.provision` audit |
| Password | Accepted in JSON body only; **never** returned in response or logs |

### Example body

```json
{
  "dealerCode": "NEWPORT",
  "confirmDealerCode": "NEWPORT",
  "dealerName": "Mercedes-Benz of Newport Group",
  "rooftopName": "Mercedes-Benz of Newport",
  "templateId": "mercedes-rooftop-v1",
  "manager": {
    "name": "Alex Rivera",
    "email": "alex.rivera@example-dealer.com",
    "password": "temporary-strong-password",
    "d7Number": "D7NEWPORT1"
  },
  "ifExists": "fail",
  "dryRun": false
}
```

### Safe response (no secrets)

```json
{
  "created": true,
  "skipped": false,
  "dryRun": false,
  "dealerId": "…",
  "dealershipId": "…",
  "managerId": "…",
  "templateId": "mercedes-rooftop-v1",
  "rooftopName": "Mercedes-Benz of Newport",
  "dealerCode": "NEWPORT",
  "auditLogId": "…",
  "mustChangePassword": true,
  "logins": [{ "role": "manager", "identifierType": "d7" }]
}
```

Prefer CLI for production operator workflows; HTTP is for controlled national-owner automation.

---

## Code map

| Piece | Path |
|-------|------|
| Provision engine | [`src/lib/apex/provisionDealer.ts`](../src/lib/apex/provisionDealer.ts) |
| Templates | [`src/lib/apex/dealerTemplates.ts`](../src/lib/apex/dealerTemplates.ts) |
| CLI | [`scripts/provision-dealer.ts`](../scripts/provision-dealer.ts) |
| npm script | `npm run provision-dealer` |
| HTTP owner API | [`src/app/api/owner/provision-dealer/route.ts`](../src/app/api/owner/provision-dealer/route.ts) |
| Forced password UI | [`src/components/ForcedPasswordChangeScreen.tsx`](../src/components/ForcedPasswordChangeScreen.tsx) |
| API gate | [`src/lib/apiRoute.ts`](../src/lib/apiRoute.ts) (`skipPasswordChange`) |
| Change password | [`src/app/api/auth/change-password/route.ts`](../src/app/api/auth/change-password/route.ts) |
| Unit tests | [`tests/unit/provisionDealer.test.ts`](../tests/unit/provisionDealer.test.ts) |
| Integration tests | [`tests/integration/dealer-provision.test.ts`](../tests/integration/dealer-provision.test.ts) |
| Smoke script | `npm run smoke:dealer-provision` → [`scripts/smoke-dealer-provision.ts`](../scripts/smoke-dealer-provision.ts) |
| Pre-rollout gate | [`scripts/pre-rollout-validation.ts`](../scripts/pre-rollout-validation.ts) section **APEX Dealer Provision** |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Invalid credentials after provision | App pointed at different DB / wrong mode | Confirm Apex DB URL + `PLATFORM_MODE=apex` |
| Stuck on login after password change | Expected reauth | Sign in again with **new** password |
| `PROVISION_DB_REQUIRED` | Production without narrow URL | Set `PROVISION_DATABASE_URL` or break-glass env |
| `PROVISION_DAILY_CAP` | Cap hit | Wait UTC day or raise `APEX_MAX_PROVISIONS_PER_DAY` intentionally |
| `MANAGER_D7_REQUIRED` | Mercedes template without D7 | Pass `--manager-d7` |
| `MANAGER_USERNAME_REQUIRED` | Generic template without username | Pass `--manager-username` |
| Forced screen never appears | Session missing `mustChangePassword` | Confirm migration + provision path; re-login |

---

## Out of scope (v1)

- Full national-console **UI form** for provision (HTTP API is opt-in; CLI remains primary)  
- Nickname / short rooftop codes in UI  
- Cloning Tiverton custom templates into new rooftops  
- Automatic email delivery of temporary passwords  
- Setting `mustChangePassword` on manager **admin password reset** (Settings reset does not yet force the gate — use only for known recovery paths)

---

*Finalized — secure dealer provisioning system complete (PR-P1–P4).*
