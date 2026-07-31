# Merlinus Production Attack Plan

**Document type:** Engineering + ops execution roadmap  
**Product:** Merlinus / Apex v4.1.x  
**Audience:** Platform owner, engineering, dealership pilot lead  
**Updated:** 2026-07-31  
**Status:** Active — execute in phase order; do not skip security gates  

This is the **directional plan** to move from “features exist, some health yellow/red, docs claim ready” to **real pilot programs**, then **enterprise multi-rooftop production** without destroying working workflows.

| Related SSoT | Use for |
|--------------|---------|
| [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) | Sign-off checkboxes before GO |
| [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md) | Residual risk signatures (tenancy honesty) |
| [Rollout-Runbook.md](./Rollout-Runbook.md) | Store-by-store deploy sequence |
| [Multi-Tenant-Isolation.md](./Multi-Tenant-Isolation.md) | How isolation actually works on D1 |
| [Security-Fortress.md](./Security-Fortress.md) | Control inventory |
| [Product-Modules.md](./Product-Modules.md) | What is always-on vs opt-in SKU |

---

## 0. North star (what “done” means)

### Pilot-ready (first 1–3 Mercedes rooftops)

- Core RO → evidence → AI story → certify → Copy for CDK / PDF works under **real multi-tech load**
- Health: **KV green**, **MFA green or intentionally enrolled**, AI queue not critical
- **Tenant isolation proven** (store A cannot see store B)
- Modules default **off** unless contracted for that pilot
- National owner can see **billing meters** (stories / regen / SMS) per rooftop
- On-call can diagnose Health tab without engineering archaeology

### Enterprise-ready (scale to many dealers)

- Same as pilot, plus:
  - `MERLIN_MFA_ENFORCE=true` after all elevated roles enrolled
  - Queue consumer + KV proven under peak bay hours
  - Provision → onboard → enter rooftop is a 15-minute playbook
  - Third-party auditor finds **honest docs**, clean gates, no seed secrets, no silent stubs sold as finished
  - Billing rates locked; estimates match finance model
  - Independent pen-test scheduled or completed

**Honest architecture claim forever:** multi-tenant isolation is **application-layer on Cloudflare D1**, not Postgres/database RLS. Market and contract only what is true ([Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md)).

---

## 1. Guiding principles (surgical repair)

1. **Do not re-scaffold.** Edit in place; preserve bay workflow that already works.
2. **Core story first.** Warranty narrative is always on. Product modules are SKUs — off by default for pilots.
3. **Classify every bug** before coding:
   - `product-incomplete` · `module-off` · `ops-misconfig` · `deferred-by-design` · `tenant-bug` · `regression` · `load`
4. **Static gates ≠ pilot proof.** `npm test` + `ready-to-deploy` are necessary; **persona journeys on staging** are required.
5. **One environment truth.** Cloudflare Workers + OpenNext + D1 + R2 + KV (not mixed “Vercel Postgres” mental model in ops).
6. **No fake enterprise.** Deferred CDK live sync, DMS revenue feeds, and DB RLS must stay labeled deferred — never sold as live.
7. **Measure load before national sales.** Multi-tech soak on pilot store before “hundreds of dealers.”

---

## 2. Phase map (execute in order)

```text
P0  Stabilize platform health     (days)
P1  Single-rooftop pilot lock     (1–2 weeks)
P2  Multi-tech soak + billing     (1–2 weeks)
P3  Multi-rooftop / group         (2–4 weeks)
P4  National GO packaging         (ongoing)
P5  Auditor-grade cleanup         (parallel from P1)
```

Each phase has: **goal · exit criteria · workstreams · kill switches**.

---

## PHASE P0 — Stabilize platform health (do first)

### Goal

Remove red/yellow that block trust and fail-closed auth before any pilot traffic.

### In-app (national owner — preferred for pilots)

National **Onboard New Dealership** runs live platform readiness in the console
(button: **Run readiness checks**). Create is blocked until critical gates pass.
After create, a **rooftop pilot checklist** verifies modules off / password / MFA.

- API: `GET /api/owner/pilot-readiness` (platform) · `?dealershipId=` (rooftop)
- Break-glass: `APEX_PROVISION_SKIP_READINESS=true` (not for production pilots)

CI scripts remain for engineers; owners do not need a terminal.

### Automation (run every deploy)

```bash
# Code / binding gates (CI + local) — writes docs/generated/p0-deploy-verify-latest.md
npm run verify:p0

# After deploy: live Health probe (manager session cookie)
MERLIN_BASE_URL=https://your-worker.example \
MERLIN_HEALTH_COOKIE='benz_tech_session=…' \
  npm run verify:p0:live

# Strict: exit non-zero if live critical health fails
npm run verify:p0 -- --live --strict-live
```

Capability matrix (living route → module → pilot status):

```bash
npm run matrix:generate    # docs/generated/CAPABILITY-MATRIX.md
npm run matrix:check       # fail if matrix stale vs source
npm run test:isolation     # tenant isolation + matrix integration tests
```


### Workstreams

| ID | Item | Owner | Notes |
|----|------|-------|-------|
| P0-1 | **Deploy KV binding fix** | Eng | Code: OpenNext `getCloudflareContext` for `KV_STORE` (same path as R2). Redeploy Worker. |
| P0-2 | **Verify KV green** | Ops | Manager → Health → `kv` OK + probe message. If still red: confirm `wrangler.toml` `[[kv_namespaces]] binding = "KV_STORE"` + namespace id + redeploy. |
| P0-3 | **MFA enrollment** | Manager | Every manager/owner on pilot rooftop enrolls TOTP in Settings. |
| P0-4 | **MFA health green** | Ops | Health shows enrolled / OK. **Do not** set `MERLIN_MFA_ENFORCE=true` until 100% elevated enrolled. |
| P0-5 | **AI queue not critical** | Ops | Producer `AI_JOBS_QUEUE` bound; consumer Worker up; Control Center `queueSignal` not error. |
| P0-6 | **Secrets hygiene** | Ops | No `OWNER_SEED_PASSWORD*` on production; `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_HMAC_KEY`, `GROK_API_KEY` strong and set; dual-key previous **unset** except rotation. |
| P0-7 | **Object storage** | Ops | R2 `APEX_R2` bound; photo/upload path works once. |

### Exit criteria (P0)

- [ ] Health: `kv` = ok  
- [ ] Health: `mfaPolicy` = ok (enrolled or enforce on)  
- [ ] Health: `aiJobsQueue` ≠ error  
- [ ] Health: `ownerSeedSecrets` ≠ error  
- [ ] Auth login + rate limit path does not 503 on KV  
- [ ] Commit deployed is known and recorded  

### Kill switch

If KV or database is red → **no pilot users**. Fix ops/bindings only.

---

## PHASE P1 — Single-rooftop pilot lock (your MB store)

### Goal

One live dealership, **core story only**, predictable bay workflow, zero surprise modules.

### Product scope (in)

- Login / session / MFA enroll  
- RO list / create / scan  
- Line notes (voice + typing)  
- Diagnostic evidence  
- Generate story / edit / audit score / certify  
- Copy for CDK (clipboard) + PDF  
- Customer Pay templates (no AI)  
- Manager Control Center: health, jobs, modules (view-only toggles)  
- Audit trail access for managers  

### Product scope (out for P1)

| Out | Why |
|-----|-----|
| Live CDK API sync | Deferred by design |
| Voice phone agents / Twilio | Ops + legal + load complexity |
| Video MPI + customer SMS | SMS cost + extra failure modes |
| Loaner / maintenance / parts-sales-service inboxes | Not needed to prove warranty narrative |
| DMS revenue metrics | Requires external feed |
| National mass onboard | After soak |

**Rule:** In Manager → Modules, leave non-contracted SKUs **off**. Pilots fail when techs open half-enabled surfaces.

### Workstreams

| ID | Item | How |
|----|------|-----|
| P1-1 | Provision pilot rooftop | Owner provision playbook; unique passwords; rotate seeds |
| P1-2 | Staff accounts | Managers + techs; MFA on elevated |
| P1-3 | Bay tablets | Staging URL or prod pilot URL; PWA install if used |
| P1-4 | Training | Bay reference card + 30-min manager walkthrough |
| P1-5 | Golden path script | See §4 — run twice with two different techs |
| P1-6 | Companion rule | One active editor per line at cert peak (LWW) |
| P1-7 | Support channel | Who gets page if Health goes red during shop hours |

### Exit criteria (P1)

- [ ] Two technicians complete golden path same day without eng intervention  
- [ ] At least 10 real (or realistic) AI stories generated and certified  
- [ ] Zero cross-tenant anomalies (only one rooftop exists — still verify national owner cannot leak PII in national scope)  
- [ ] Billing tab shows first-story counts matching known generates  
- [ ] No P0 health regression  

---

## PHASE P2 — Multi-tech soak + billing truth

### Goal

Prove the system under **concurrent bay load** and that **billing meters** are trustworthy before selling per-story pricing.

### Load / soak plan

| Scenario | Target | Pass |
|----------|--------|------|
| Concurrent techs | 5–15 simultaneous sessions | No mass 401/429/5xx; RO list usable |
| Concurrent generates | 5+ story jobs in flight | Queue depth recovers; not stuck critical 45m+ |
| Photo batches | 3 techs uploading evidence | R2 OK; no Worker OOM pattern |
| Companion + tablet | Dirty edit + second device | LWW documented; no silent data loss without toast |
| Peak hour simulation | 2-hour window | Health stays ok/degraded, never silent failure |
| Offline / flaky network | Tablet airplane mode recovery | Manual typing works; save conflict UX clear |

### Metrics to watch

- Manager Control Center: queue depth, failed jobs, inline fallback count  
- `/api/health` + Sentry 5xx  
- Grok latency / rate limits  
- D1 errors  
- First-story **UsageEvent** count vs audit `story.generate` (regen = generate − first)  
- National **Billing** tab estimates  

### Billing lock (commercial)

| Decision | Recommendation |
|----------|----------------|
| Billable unit | First AI story per repair line (`story_generated`) |
| Not billable as full story | Customer Pay templates, pure edits without generate |
| Token recoup | Regen fee lower than first story |
| Platform fee | Monthly per rooftop (covers hosting, audit, support) |
| SMS | Metered when Video MPI SMS is enabled later |
| Pilot pricing | Prefer **platform + discounted story rate** for first 30–60 days to learn true volume |

Default estimate knobs (Worker secrets):  
`BILLING_PLATFORM_MONTHLY_CENTS`, `BILLING_STORY_FIRST_CENTS`, `BILLING_STORY_HIGH_VOLUME_CENTS`, `BILLING_HIGH_VOLUME_THRESHOLD`, `BILLING_STORY_REGEN_CENTS`, `BILLING_SMS_CENTS`.

### Exit criteria (P2)

- [ ] Soak scenarios pass or residual issues are filed with severity  
- [ ] Billing first-story totals reconcile ± small expected lag with known generates  
- [ ] Runbook: “what to do when queue is critical” known to manager  
- [ ] Written decision on pilot commercial terms  

---

## PHASE P3 — Multi-rooftop / group (2–N dealers)

### Goal

Add rooftops as sales close **without data bleed** and with repeatable provision.

### Workstreams

| ID | Item | Detail |
|----|------|--------|
| P3-1 | Isolation proof | Automated + manual: RO/images/tickets of A never visible to B session |
| P3-2 | RLS registry discipline | Every new Prisma model registered; `npm run check:rls-registry` in CI |
| P3-3 | API default-deny | `npm run check:api-routes`; no bare routes without allowlist reason |
| P3-4 | Provision playbook | Owner onboard → modules off → staff → MFA → smoke 15 min |
| P3-5 | Group owner scope | Group portfolio sees only its dealers; platform operator national only as designed |
| P3-6 | MFA enforce | After all pilot elevated users enrolled: `MERLIN_MFA_ENFORCE=true` |
| P3-7 | Per-rooftop entitlements | Modules match contract only |
| P3-8 | Billing by rooftop | Owner Billing tab used for invoice prep (even if invoicing is offline) |

### Tenant isolation test matrix (minimum)

| # | Test | Pass |
|---|------|------|
| T1 | Tech A lists ROs — only A’s dealershipId | |
| T2 | Crafted API id for B’s RO as A | 404/403, no body leak |
| T3 | Image/blob URL from B as A | Denied |
| T4 | Owner national summary | No customer PII in national aggregates |
| T5 | Enter rooftop / exit | Scope switches cleanly; audit logged |
| T6 | `withRlsBypass` call sites | Reviewed; no new bypass without justification |

### Exit criteria (P3)

- [ ] ≥2 real rooftops live  
- [ ] Isolation matrix signed  
- [ ] Provision of rooftop N is boring (documented, timed)  
- [ ] MFA enforce on  
- [ ] Buyer residual risks acknowledged for multi-store  

---

## PHASE P4 — National GO packaging (scale readiness)

### Goal

Sales can add dealers without engineering heroics; ops can run the fleet.

### Workstreams

| ID | Item |
|----|------|
| P4-1 | Complete [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) signatures |
| P4-2 | Sign [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md) for multi-store |
| P4-3 | On-call + Health playbooks (KV, queue, Grok, encryption rotation) |
| P4-4 | Key rotation cadence (recommend 90 days) with MFA in reencrypt plan |
| P4-5 | Capacity model: concurrent techs × stories/day × Grok + Worker limits |
| P4-6 | Backup / D1 export / incident restore drill (document RPO/RTO realistic for D1) |
| P4-7 | Support tiers: pilot vs paid production SLAs |
| P4-8 | Pen-test or external ASVS-style review against **current** branch (in-repo ASVS is dated) |
| P4-9 | Legal: DPA with xAI, Twilio (if voice/SMS), privacy/terms current |
| P4-10 | Marketing claims review — remove overclaim language (DB RLS fortress, 99/100, etc.) |

### Scale risks (plan, don’t ignore)

| Risk | Mitigation |
|------|------------|
| App-layer tenancy bug | Registry CI, code review checklist, isolation tests, limited bypass |
| Single platform DEK | Dual-key rotation runbook; secret hygiene; no DEK in client |
| AI queue backlog | Critical health; consumer autoscaling play; inline fallback ≠ green |
| Grok cost / rate limits | Billing meters; daily caps; model choice; cache where safe |
| Worker CPU/time limits | Async jobs for long AI; avoid sync heavy work on request path |
| Multi-isolate rate limit | KV required; never run Apex prod without KV |
| Companion LWW | Training; process: one certifier per line |

### Exit criteria (P4)

- [ ] Conditional GO or GO recorded with commit SHA + Worker URL  
- [ ] Sales enablement: what is sold vs deferred  
- [ ] Capacity headroom statement for next 20 rooftops  

---

## PHASE P5 — Auditor-grade codebase cleanup (parallel)

### Goal

When a third party reads the repo, it looks **intentional, honest, and gated** — not a maze of half-modules and contradictory docs.

### Workstreams

| ID | Cleanup theme | Actions |
|----|---------------|---------|
| P5-1 | **Doc honesty** | Align README badges with Buyer Risk + ASVS reality; fix remaining Vercel/Postgres deploy lines to Cloudflare/D1 truth |
| P5-2 | **Deferred surfaces** | Keep CDK deferred docs; Manager UI already labels deferred — no fake connectors |
| P5-3 | **Dual-stack debt** | Inventory Supabase/Vercel KV REST leftovers; either delete dead paths or clearly mark legacy |
| P5-4 | **Migration dualism** | Prisma migrations history + D1 `migrations/` — document which is SSoT for prod apply |
| P5-5 | **API surface map** | Maintain capability matrix: route → module → role → pilot status |
| P5-6 | **Test strategy** | Keep unit gates green; grow integration isolation + critical-path tests; one E2E bay smoke in CI against staging when possible |
| P5-7 | **Secret scanning** | `check:seed-secrets` in CI; no credentials in repo ever |
| P5-8 | **Dead code** | Remove or quarantine unused experimental paths after inventory (do not delete active bay code) |
| P5-9 | **Logging/PII** | Confirm redaction; no story text or customer PII in Sentry |
| P5-10 | **Dependency hygiene** | `npm audit` high/critical triage; pin deploy Node/tooling versions |

### Capability matrix template (maintain in sheet or markdown)

| Surface | Module | Roles | Pilot? | Test | Owner |
|---------|--------|-------|--------|------|-------|
| Generate story | core (always) | tech+ | Yes | journey | |
| CDK live sync | cdk_sync | — | No / deferred | n/a | |
| Video SMS | video_mpi | tech+ | Optional | journey | |
| Owner billing | national | owner | Yes | API | |
| … | | | | | |

### Exit criteria (P5)

- [ ] External reader can answer “what is production vs deferred” in 15 minutes from docs  
- [ ] CI gates: test + rls registry + api routes + seed secrets  
- [ ] No critical secret findings  
- [ ] Overclaim language removed or footnoted  

---

## 3. Engineering gates (every deploy)

Run before promoting any build that pilots touch:

```bash
npm test
npm run typecheck
npm run check:seed-secrets
npm run check:rls-registry
npm run check:api-routes
npm run ready-to-deploy
```

Against live staging:

```bash
MERLIN_BASE_URL=https://your-staging-host npm run validate:pre-rollout
```

**Rule:** zero critical **code** failures. Config failures mean ops is not ready — do not paper over with “tests passed.”

---

## 4. Golden path scripts

### 4.1 Technician (core pilot)

1. Login (MFA if enforced)  
2. Open RO list — create or open RO  
3. Open warranty line  
4. Add notes (type + optional voice)  
5. Add diagnostic photo(s) → process  
6. Generate MI story  
7. Edit if needed → Audit / score  
8. Certify  
9. Copy for CDK  
10. Export PDF  
11. Customer Pay line: apply template (no AI)  

### 4.2 Manager

1. Control Center overview  
2. Health tab — all critical green  
3. AI Jobs — no stuck critical backlog  
4. Modules — only contracted SKUs on  
5. MFA roster — elevated enrolled  
6. Audit log sample  

### 4.3 National owner

1. National dashboard loads  
2. **Billing** tab — period 7d/30d; rooftop rows  
3. Provision or enter pilot rooftop  
4. Exit to national — no residual PII scope  

### 4.4 Negative security (staging)

1. Cross-rooftop RO id → deny  
2. Disabled module API → 403 MODULE_DISABLED  
3. Logged-out mutating call → 401  
4. CSRF missing on cookie session mutate → deny  

---

## 5. Bug triage workflow (keep the pilot clean)

```text
Report → reproduce on staging → classify tag → severity → fix or document deferred → re-run golden path → deploy
```

| Severity | Meaning | SLA mindset |
|----------|---------|-------------|
| S0 | Data leak / auth bypass / wrong tenant | Drop everything |
| S1 | Bay blocked (cannot generate/certify/login) | Same day |
| S2 | Degraded (queue warn, partial UI) | Next deploy window |
| S3 | Polish / docs | Backlog |

Never “fix in prod” without classification — that is how placeholders reappear.

---

## 6. What “massive dealer scale” requires beyond code

Code readiness is not enough for hundreds of rooftops:

| Capability | Needed |
|------------|--------|
| Provision automation | Already partially present — harden + train |
| Billing / invoicing | Meters in-app; finance system of record may be external |
| Support | Tiered response; Health playbooks |
| Capacity | Grok spend alerts; queue consumer capacity; D1 limits |
| Compliance | DPA, retention, audit export, pen-test |
| Sales packaging | SKU list, deferred list, pilot vs production contract |

---

## 7. Immediate 14-day plan (recommended start)

| Day | Focus |
|-----|--------|
| 1 | Deploy KV/MFA health + billing code; verify Health KV green |
| 1–2 | Enroll all pilot managers in MFA; confirm MFA health ok |
| 2 | Secrets audit; queue consumer green; modules all off except core |
| 3 | Golden path twice (2 techs) on pilot rooftop |
| 4–5 | Generate 10+ real stories; reconcile Billing tab |
| 6–8 | Multi-tech soak (half-day); file S0–S2 only |
| 9 | Isolation review + `ready-to-deploy` clean |
| 10–11 | Fix S1s only; re-soak critical paths |
| 12 | Manager + owner training dry-run |
| 13 | Pilot GO / Conditional GO decision with checklist |
| 14 | Controlled pilot live hours; on-call watch Health + queue |

---

## 8. Decision log (fill as you go)

| Date | Decision | Rationale | Owner |
|------|----------|-----------|-------|
| | Pilot store identity | | |
| | Modules in pilot | Core only / list | |
| | Story price + platform fee | | |
| | MFA enforce date | | |
| | Second rooftop date | | |
| | Pen-test vendor / date | | |

---

## 9. Definition of GO verdicts

| Verdict | Meaning |
|---------|---------|
| **NO-GO** | KV/DB/queue critical, tenant tests fail, or seed secrets on prod |
| **Conditional GO** | Single-rooftop pilot; modules limited; MFA enrolled; residuals accepted |
| **GO (multi-rooftop)** | P3 exit + buyer risk signed + MFA enforce + checklist criticals |
| **GO (national scale)** | P4 capacity + pen-test plan + support model + clean auditor posture |

---

## 10. One-page summary

**Direction:** Stabilize health → lock one MB pilot on **core story** → soak multi-tech + prove billing → add rooftops with isolation discipline → national packaging + auditor cleanup.

**Do not:** enable every module, promise live CDK, claim DB RLS, or scale sales before soak.

**Do:** classify bugs, keep gates green, train LWW companion, meter stories honestly, enforce MFA when enrolled, and keep docs as honest as the code.

---

*This attack plan is the execution spine. Sign-off grids remain in Production-Readiness-Checklist.md; residual risk in Buyer-Risk-Acceptance-Summary.md.*
