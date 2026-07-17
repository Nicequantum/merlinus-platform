# Product Modules

**Product:** Merlinus / Apex dealership OS  
**Scope:** Toggleable rooftop capabilities layered on the always-on core story pipeline  
**Last updated:** 2026-07 (post PR-M8 polish)

---

## Golden rule

**Core story is never a product module.**

The repair-order → evidence → AI warranty narrative pipeline (`core_story`) is always on. It does **not** appear in `ModuleId`, seed defaults, manager toggles, or `MODULES_FORCE_ENABLE`. Feature work must not wrap the core RO story path in module gates.

---

## Catalog

| Module ID | Name | Status | Seed default |
|-----------|------|--------|--------------|
| `video_mpi` | Video MPI | Shipped (PR-M1a/M1b) | **On** |
| `maintenance` | Maintenance Management | Shipped (PR-M3) | **On** |
| `voice_agent` | AI Voice Agent | Shipped (PR-M5a/M5b) | **On** |
| `loaner` | Loaner Car Management | Shipped (PR-M4) | **On** |
| `parts` | Parts Department | Shipped (PR-M2) | **On** |
| `sales` | Sales Department | Shipped (PR-M8) | **On** |
| `service` | Service Department | Shipped (PR-M8) | **On** |
| `cdk_sync` | CDK Global Sync | Deferred (PR-M7 — needs API credentials) | **Off** |

Source of truth for IDs and display copy: `src/lib/modules/catalog.ts`  
Seed list: `SEED_ENABLED_MODULE_IDS` (excludes `cdk_sync`).

---

## Enablement resolution

Effective status for a rooftop + module (first match wins):

1. **`MODULES_FORCE_ENABLE`** env (comma-separated module IDs) — ops/dev break-glass  
2. **`DealershipModule`** row for that rooftop  
3. **`DealerGroupModule`** for the rooftop’s dealer group  
4. **Default: off** (opt-in)

Managers write only step 2 via **Manager Dashboard → Modules** (`GET/PATCH /api/modules`).

Forced-env modules show as Enabled with source “Forced (env)”; the UI toggle is locked until the env override is cleared.

---

## Seed & provision

| Path | Behavior |
|------|----------|
| `npm run db:seed` / `runDatabaseSeed` | For **every** dealership, create missing `DealershipModule` rows: seed-enabled modules **on**, others (e.g. `cdk_sync`) **off**. Existing rows are **not** overwritten. |
| Apex dealer provision | Same defaults for the new rooftop inside the provision transaction. |

Re-running seed is safe for modules: manager choices on existing rows are preserved.

---

## Manager / owner UX

- **Manager** (or owner **View As** manager with dealership context): list + toggle modules for the active rooftop.  
- Toggles call `PATCH /api/modules` with `{ moduleId, enabled }` and write an audit action `module.set`.  
- National-scope owners must **enter a dealership** before managing modules.  
- Disabled modules show a shared empty state (`ModuleDisabledNotice`) in Video MPI, Maintenance, Parts/Sales/Service inboxes, Loaner, and Voice ops.

---

## Department inboxes (Parts / Sales / Service)

Shared spine: `DepartmentRequest` + `DepartmentRequestDashboard`.

| Department | Module | Staff role | Voice tools |
|------------|--------|------------|-------------|
| parts | `parts` | `parts` | `create_parts_request` |
| sales | `sales` | `sales` | `create_sales_request` |
| service | `service` | `service` | `create_service_request` |

Managers and owners can open all three inboxes. Voice ticket creation requires the matching module to be enabled (in addition to `voice_agent` for the call path).

---

## Related roles (not modules)

| Role | Primary home |
|------|----------------|
| `technician` | RO list + core story |
| `service_advisor` | Advisor dashboard |
| `manager` / `owner` | Manager / national shells |
| `parts` / `sales` / `service` | Department inboxes |
| `maintenance` | Maintenance kanban |
| `loaner` | Loaner fleet |

---

## Break-glass

```bash
# Local / emergency only — never a substitute for rooftop rows in production
MODULES_FORCE_ENABLE=video_mpi,parts,sales,service,loaner,maintenance,voice_agent
```

Do **not** put `core_story` in this list (it is not a valid product module id).

---

## What is intentionally unfinished

| Item | Notes |
|------|--------|
| **PR-M7 CDK Global Sync** | Module id reserved; live API client blocked until credentials/access. Clipboard CDK paste for RO context remains available without this module. |
| Dealer-group module admin UI | Group defaults resolve correctly; UI today is rooftop-scoped. |
| Live multi-rooftop E2E | Staging smoke still recommended before first production rooftop. |

## Production hardening hooks

| Concern | Where |
|---------|--------|
| Env validation | `src/lib/modules/envValidation.ts`, `scripts/validate-env.mjs` |
| Pre-deploy module PII / Twilio guards | `scripts/validate-pre-deploy.mjs` → `checkProductModuleHardening` |
| Manager toggle audit | `module.set` in `src/lib/audit.ts` + `/api/modules` PATCH |
| Sentry tags | `moduleId` on module gate blocks; release/env on server init |
| Checklists | [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md), [Go-Live-Deployment-Checklist.md](./Go-Live-Deployment-Checklist.md) |

---

## Code map

| Concern | Path |
|---------|------|
| Catalog / seed IDs | `src/lib/modules/catalog.ts` |
| Resolution + seed helpers + set | `src/lib/modules/entitlements.ts` |
| Manager API | `src/app/api/modules/route.ts` |
| Manager UI | `src/components/ManagerDashboard.tsx` |
| Shared disabled notice | `src/components/modules/ModuleDisabledNotice.tsx` |
| withAuth gate | `requireModule` on `src/lib/apiRoute.ts` |
| Department gates | `src/lib/department/moduleGate.ts` |
| Seed wiring | `src/lib/seedDatabase.ts` |
| Provision wiring | `src/lib/apex/provisionDealer.ts` |
