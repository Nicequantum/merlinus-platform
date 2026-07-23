# Merlinus Modular Dealership OS — Feature Complete Summary

**Document type:** Executive + operations handover  
**Status:** Feature-complete for shippable modules (CDK live sync deferred) · **v4.1.0 national readiness package**  
**Code baseline:** `main` @ v4.1.0 (modular expansion + fortress + Async AI + diligence packet)  
**Last updated:** 2026-07-22  
**Related:** [Product-Modules.md](./Product-Modules.md) · [**Production-Readiness-Checklist.md**](./Production-Readiness-Checklist.md) · [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md) · [Go-Live-Deployment-Checklist.md](./Go-Live-Deployment-Checklist.md) · [Support-Playbook.md](./Support-Playbook.md)

---

## 1. Executive overview

Merlinus has grown from a warranty narrative platform into a **modular dealership operating system**: the always-on repair-order → evidence → AI story pipeline remains the non-negotiable core, while optional rooftop products—Video MPI, facility maintenance, parts/sales/service inboxes, loaner fleet, and multi-agent phone voice—can be enabled per dealership without feature-flagging or weakening core story. Product access is controlled by a first-class **module entitlements** system (rooftop rows, group defaults, manager toggles, audited changes). Department work shares a single **DepartmentRequest** spine so voice agents and staff UI write into the same inboxes. The codebase is hardened for production gates (env validation, encryption, audit, Sentry tags); pilot go-live now depends on **infrastructure deployment** (real staging/production host, secrets, migrations), not further product modules—except live CDK Global API sync, which remains reserved until credentials exist.

---

## 2. Shipped modules and key capabilities

### Always on (not a module)

| Capability | Description |
|------------|-------------|
| **Core story** | RO scan/list, Xentry/diagnostic evidence, Grok warranty narrative, Customer Pay templates, certification, PDF/copy for DMS paste. Never appears as `ModuleId` / never disableable via Modules UI. |

### Product modules (toggleable)

| Module ID | Name | PR | Key capabilities |
|-----------|------|-----|------------------|
| `video_mpi` | Video MPI | M1a / M1b | Multi-point video inspections, findings checklist, severity board, chunked upload, offline queue, share links, optional SMS delivery |
| `parts` | Parts Department | M2 | Parts inbox on DepartmentRequest; part lines/lookups; parts staff home; manager tile |
| `maintenance` | Maintenance Management | M3 | Cross-dept facility/shop tickets; kanban; photos; maintenance role |
| `loaner` | Loaner Car Management | M4 | Fleet vehicles, status, assignments/returns, loaner desk role |
| `voice_agent` | AI Voice Agent (Sophia) | M5a / M5b | Twilio phone AI + tablet department query; receptionist + specialists; transcripts; containment metrics |
| `voice_agent_service` | Sophia · Service | Dept | Service-desk tablet + phone specialist (appointments, warranty follow-up). Requires `voice_agent` + `service`. **Pilot default on** |
| `voice_agent_loaner` | Sophia · Loaner | Dept | Loaner fleet assistant (availability, reservation). Requires `voice_agent` + `loaner`. **Pilot default on** |
| `voice_agent_parts` | Sophia · Parts | Dept | Parts counter assistant. Requires `voice_agent` + `parts` |
| `voice_agent_sales` | Sophia · Sales | Dept | Sales assistant. Requires `voice_agent` + `sales` |
| `sales` | Sales Department | M8 | Sales inbox (shared DepartmentRequest shell); sales role home; manager tile; voice-created leads |
| `service` | Service Department | M8 | Service inbox (shared shell); service role home; manager tile; voice follow-ups |
| `cdk_sync` | CDK Global Sync | M7 **deferred** | Catalog placeholder only—live API client not implemented; **clipboard CDK paste for RO context remains available** without this module |

### Supporting platform (PR-M0 + polish)

| Capability | Description |
|------------|-------------|
| **Entitlements** | `DealershipModule` / `DealerGroupModule`, catalog, force-env break-glass, seed/provision defaults |
| **Manager Modules UI** | Enable/disable per rooftop; audited `module.set` |
| **Roles** | `parts`, `sales`, `service`, `maintenance`, `loaner` (plus existing technician / manager / service_advisor / owner) |
| **Hardening** | Module env validation, Twilio signature fail-closed in prod, Sentry release/env tags, go-live checklists |

**Seed defaults (new rooftops):** video_mpi, maintenance, voice_agent, loaner, parts, sales, service **on**; cdk_sync **off**. Existing rooftop rows are never overwritten on re-seed.

---

## 3. Architecture overview

### 3.1 Layering

```
┌─────────────────────────────────────────────────────────────────┐
│  UI shells (role-based)                                         │
│  Technician · Advisor · Manager · Parts/Sales/Service · …       │
├─────────────────────────────────────────────────────────────────┤
│  Product surfaces                                               │
│  Video MPI · Maintenance · Department inboxes · Loaner · Voice  │
├─────────────────────────────────────────────────────────────────┤
│  Entitlements  isModuleEnabled / requireModule / moduleGate     │
├─────────────────────────────────────────────────────────────────┤
│  Domain services + encrypted PII fields                         │
├─────────────────────────────────────────────────────────────────┤
│  ALWAYS ON: RepairOrder / RepairLine / story AI / audit chain   │
├─────────────────────────────────────────────────────────────────┤
│  D1 app-layer tenancy · R2/Blob · KV · Queues · Grok · Twilio   │
└─────────────────────────────────────────────────────────────────┘
```

**Tenancy (v4.1 honesty):** **Application-layer RLS on Cloudflare D1** (registry + Prisma extension). **Not** Postgres/database-enforced RLS. Sign-off: [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) · residual risk: [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md).

**Rule:** Module gates wrap **optional** surfaces only. Story generate/score/review/certify paths must not depend on product modules.

### 3.2 Entitlements resolution

For a rooftop + product module id (first match wins):

1. **`MODULES_FORCE_ENABLE`** env (ops break-glass; locked in Manager UI)  
2. **`DealershipModule`** row (manager toggle → `PATCH /api/modules`)  
3. **`DealerGroupModule`** default for the rooftop’s group  
4. **Default: disabled** (opt-in)

API routes use `withAuth({ requireModule: '…' })` or department-specific `assertDepartmentModuleEnabled`. Disabled modules return `403` + `MODULE_DISABLED` and UI shows **Manager Dashboard → Modules** guidance.

### 3.3 DepartmentRequest spine

Parts, Sales, and Service share one model and UI shell:

| Concept | Detail |
|---------|--------|
| Model | `DepartmentRequest` (+ `PartsRequestLine` / lookups for parts) |
| UI | `DepartmentRequestDashboard` + thin `Parts` / `Sales` / `Service` wrappers |
| Access | Role match (parts/sales/service) or manager/owner |
| Sources | `manual`, `voice_agent`, `web`, `cdk` (reserved) |
| PII | Customer name/phone/email/VIN/summary stored encrypted |

### 3.4 Voice agents

```
Twilio DID  →  /api/voice/inbound|gather|…  (signature verified)
           →  receptionist agent
           →  handoff: parts | sales | service | loaner
           →  tools create DepartmentRequest / loaner work
           →  staff inbox / fleet board
```

- Requires **`voice_agent`** module for call path.  
- Creating a department ticket also requires the **target** module (`parts` / `sales` / `service`) to be enabled.  
- Metrics: handoffs, containment, voice ops dashboard for managers.

### 3.5 Key code map

| Concern | Path |
|---------|------|
| Module catalog / seed IDs | `src/lib/modules/catalog.ts` |
| Enablement + set + seed helpers | `src/lib/modules/entitlements.ts` |
| Manager API | `src/app/api/modules/route.ts` |
| Department API | `src/app/api/department-requests/**` |
| Shared inbox UI | `src/components/department/DepartmentRequestDashboard.tsx` |
| Voice tools / personas | `src/lib/voiceAgent/**` |
| Auth module gate | `src/lib/apiRoute.ts` (`requireModule`) |

---

## 4. Go-live instructions for the dealership

*Assumes IT has deployed current `main`, applied migrations, seeded or provisioned the rooftop, and set production secrets. Full IT steps: [Go-Live-Deployment-Checklist.md](./Go-Live-Deployment-Checklist.md).*

### 4.1 Service Manager (day of pilot)

1. **Sign in** as manager on the production/staging URL.  
2. Open **Manager Dashboard → Modules**.  
3. Confirm modules this rooftop will use are **Enabled** (typically Video MPI, Maintenance, Parts, Sales, Service, Loaner, Voice). Leave **CDK Global Sync** off until IT confirms PR-M7.  
4. **Settings → create users** with the right roles:  
   - Technicians (core story)  
   - Service advisors  
   - Parts / Sales / Service / Loaner / Maintenance staff as needed  
5. Walk each enabled tile once (Parts, Sales, Service, Maintenance, Loaner, Voice, Video Inspection).  
6. If anything says “module is disabled,” return to **Modules** and turn it on—do not ask staff to use env break-glass.  
7. Complete shop-floor tablet checks in [Go-Live-Checklist.md](./Go-Live-Checklist.md) (login, mic, story generate, Wi‑Fi).  
8. Post support contacts (IT + Service Manager) at bays.

### 4.2 Staff by role (what “success” looks like)

| Role | Home experience |
|------|-----------------|
| Technician | RO list → line → notes/voice → generate warranty story |
| Service advisor | Advisor dashboard (+ video/maintenance if enabled) |
| Parts / Sales / Service | Department inbox only (no RO story pipeline) |
| Loaner | Fleet board |
| Maintenance | Kanban board |
| Manager | Metrics + module tiles + staff admin |

### 4.3 Voice (if telephony is live)

1. IT configures Twilio DID → webhook URLs and voice lines in app.  
2. Manager keeps **AI Voice Agent** + target department modules **on**.  
3. Test call: confirm ticket appears in Parts/Sales/Service inbox with source voice.  
4. Ops dashboard shows call list / containment metrics.

### 4.4 If something breaks

| Symptom | First action |
|---------|----------------|
| “Module is disabled” | Manager → Modules → Turn on |
| Voice creates no ticket | Check voice_agent + department module SKU; Twilio signature/token; logs |
| Tablet Ask Sophia missing | Enable voice_agent_* SKU for that dept + domain module; Grok key required |

### Tablet department query (SSE)

| Item | Detail |
|------|--------|
| Route | `POST /api/voice/{service\|parts\|sales\|loaner}/query` |
| Stream | `Accept: text/event-stream` (status / intent / tool / delta / result / tailoring) |
| UI | `DepartmentVoicePanel` on Service, Parts, Sales inboxes + Loaner fleet |
| Memory | Multi-turn conversation id + handoffBrief for cross-department handoff |
| Tools | Parts: `lookup_parts_guidance`, `create_parts_request` · Sales: `note_sales_interest`, `create_sales_request` · Loaner: list/reserve · Service: follow-up tickets |

### Personal Tailoring (per dealership)

| Item | Detail |
|------|--------|
| Model | `DepartmentCustomization` + `DepartmentCustomizationVersion` |
| Manager UI | Settings → **AI Voice · Department Tailoring** |
| API | `GET/PUT /api/voice/customizations`, `POST …/[department]` reset/restore |
| Injection | Manager text prepended to department system prompt (variables: `{dealershipName}`, `{managerName}`, `{brand}`) |
| Preview | Test draft without save via `previewTailoring` on query |
| Audit | `voice.customization_update` (lengths only, not free text) |
| Photos/video fail | Blob token / network; re-upload |
| Story AI fails | Grok key / daily limit / Wi‑Fi — core story still available for typing |
| Login / rate limit issues | IT checks KV in production |

Escalate via [Support-Playbook.md](./Support-Playbook.md).

---

## 5. Remaining work and known limitations

### Deferred / not in pilot scope

| Item | Notes |
|------|--------|
| **PR-M7 CDK Global Sync** | Module id reserved; needs dealer CDK API credentials + client implementation. Clipboard paste into Merlin for RO context **already works** without this module. |
| **Dealer-group module admin UI** | Group defaults resolve in code; managers only toggle **rooftop** rows today. |
| **National multi-rooftop E2E packaging** | Apex owner/group flows exist; each pilot should still smoke the specific rooftop URL. |

### Known limitations

| Area | Limitation |
|------|------------|
| Staging from this build session | Requires Vercel credentials + real DB/secrets—code is ready; infra is operator-owned |
| Voice without Twilio | Ops UI works when module on; live calls need Twilio SID/token + public app URL |
| SMS Video MPI | Requires `SMS_ENABLED` + full Twilio SMS trio |
| Force-enable env | `MODULES_FORCE_ENABLE` is break-glass; prefer Modules UI in production |
| Unit tests needing DB | e.g. Clerk webhook handler tests fail without reachable Postgres—not a product defect |
| CDK as “module” | Do not promise live bi-directional CDK sync until PR-M7 ships |

### Intentionally non-goals

- Feature-flagging or disabling core warranty story  
- Putting secrets in client bundles (`NEXT_PUBLIC_*` xAI keys forbidden)  
- Skipping Twilio signature verification in production  

---

## 6. Testing scenarios for a pilot rooftop

Use these after deploy + seed. Mark pass/fail for the pilot record.

### 6.1 Core story (critical)

| # | Scenario | Expected |
|---|----------|----------|
| C1 | Technician login | Lands on RO home |
| C2 | Scan or open RO | Complaints / lines load |
| C3 | Dictate notes + generate story | Story returns; copy works |
| C4 | Customer Pay template (if used) | Instant apply; no Grok dependency |
| C5 | Manager metrics | Dashboard loads without error |

### 6.2 Modules control plane

| # | Scenario | Expected |
|---|----------|----------|
| M1 | Manager opens Modules | Full catalog listed; core story not listed |
| M2 | Turn **parts** off → open Parts | Disabled notice → Modules |
| M3 | Turn **parts** on | Inbox loads; toggle audited (`module.set`) |
| M4 | Refresh Modules | State persists |

### 6.3 Video MPI

| # | Scenario | Expected |
|---|----------|----------|
| V1 | Open Video Inspection | List or empty state (not crash) |
| V2 | Create draft inspection | Saved; appears on board |
| V3 | Checklist save | Findings persist |
| V4 | Share link (if used) | URL requires token; invalid token fails closed |

### 6.4 Maintenance

| # | Scenario | Expected |
|---|----------|----------|
| F1 | Open Maintenance board | Kanban columns |
| F2 | Submit ticket | Appears in submitted/triage |
| F3 | Maintenance role (optional) | Full manage vs submit-only as designed |

### 6.5 Parts / Sales / Service inboxes

| # | Scenario | Expected |
|---|----------|----------|
| D1 | Parts staff login | Parts inbox home (not RO list) |
| D2 | Create manual parts request + line | List + detail; encrypted PII only in app |
| D3 | Sales staff create lead | Sales inbox only |
| D4 | Service staff create request | Service inbox only |
| D5 | Manager opens all three tiles | Can view/create where entitled |

### 6.6 Loaner

| # | Scenario | Expected |
|---|----------|----------|
| L1 | Open Loaner fleet | Board loads |
| L2 | Add vehicle / assignment (if time) | Status updates correctly |

### 6.7 Voice (if Twilio configured)

| # | Scenario | Expected |
|---|----------|----------|
| P1 | Voice ops dashboard | Calls list / empty, not module error |
| P2 | Inbound test call | Signature accepted; agent greets |
| P3 | Route to Parts/Sales/Service | Ticket in matching inbox, source voice |
| P4 | Department module off | Tool refuses create; no orphan ticket |

### 6.8 Negative / security

| # | Scenario | Expected |
|---|----------|----------|
| S1 | Unauthenticated `/api/modules` | 401/403 |
| S2 | Public video bad token | 404 / not found |
| S3 | No public Grok keys in browser env | Confirmed by IT |

---

## 7. Handover checklist (one page)

**IT**

- [ ] Deploy current `main` to target host  
- [ ] Production secrets (DB, encryption pair, session, Grok, Blob, KV, Sentry, app URL)  
- [ ] `prisma migrate deploy` + seed/provision  
- [ ] Twilio (optional) + DID → webhooks  
- [ ] Run [Go-Live-Deployment-Checklist.md](./Go-Live-Deployment-Checklist.md)  

**Service Manager**

- [ ] Modules toggled for pilot scope  
- [ ] Staff accounts + roles created  
- [ ] Section 6 smoke scenarios executed  
- [ ] [Go-Live-Checklist.md](./Go-Live-Checklist.md) 24–48h tablet pass  
- [ ] Support contacts posted  

**Fixed Ops / GM**

- [ ] Pilot scope agreed (which modules day one)  
- [ ] Sign-off on Production-Readiness / Go-Live checklists  
- [ ] CDK live sync explicitly out of scope until credentials  

---

## 8. Document index for this product surface

| Doc | Audience |
|-----|----------|
| **This file** | Everyone — feature-complete summary & pilot playbook |
| [Product-Modules.md](./Product-Modules.md) | IT / eng — entitlements detail |
| [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) | Sign-off before production |
| [Go-Live-Deployment-Checklist.md](./Go-Live-Deployment-Checklist.md) | Deploy-time IT |
| [Go-Live-Checklist.md](./Go-Live-Checklist.md) | 24–48h shop-floor |
| [Support-Playbook.md](./Support-Playbook.md) | Day-2 support |
| [Technical-Specification-and-Architecture.md](./Technical-Specification-and-Architecture.md) | Deep architecture |
| [Apex-National-Platform.md](./Apex-National-Platform.md) | Multi-rooftop / owner |

---

*End of Feature Complete Summary. Core story always on. Optional modules are rooftop-entitled. Pilot success = deploy + manager modules + staff roles + smoke scenarios above.*
