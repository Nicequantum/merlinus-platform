# Pre-Audit Hardening Report

**Product:** Merlinus / Apex platform (Next.js 15 → OpenNext → Cloudflare Workers + D1 + R2 + KV)  
**Report date:** 2026-07-19  
**Branch baseline:** `feature/staging-mb-onboard-dealership` @ `061ed3b` (+ follow-up CI test fix)  
**Audience:** External security / CISO pre-audit review  

This report summarizes the **P0–P3** hardening completed in-repo for a clean external audit window. Runtime secrets remain **Cloudflare Workers secrets** only; they must never ship in OpenNext `next-env.mjs`.

---

## Executive summary

| Area | Status |
|------|--------|
| Unit tests | **903+ pass** (target suite green after H15 package-script assertion fix) |
| Integration tests | **40/40 pass** (local + prior CI green) |
| OpenNext secret bake gate | **Pass** (strip + verify on every quality build path) |
| Gitleaks secret scan | **Pass** (independent CI job) |
| `npm audit --audit-level=high` | **Exit 0** (only moderate `postcss` nested under `next`) |
| Workers observability | **Full logs + traces enabled** for audit period |
| Cold-start owner path | **Hardened** (warmup + client retries; local smoke 200/200) |

**Score progression (hostile baseline 1.5 / 5):** P0–P1 code and CI gates land the platform near **~3.8–4.0** for first-rooftop pilot readiness, with P2/P3 items either partial or deferred with explicit residual risk.

---

## P0 — Blockers (COMPLETE)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Stop baking secrets into OpenNext | **Done** | `scripts/strip-opennext-secrets.mjs`, `scripts/verify-opennext-no-secrets.mjs`, `scripts/secret-env-names.mjs` |
| 2 | CI OpenNext secret gate (independent of unit tests) | **Done** | `.github/workflows/ci.yml` job **OpenNext secret bake gate** |
| 3 | Local `build:opennext` matches CI strip/verify | **Done** | `package.json`: `build:opennextjs-cloudflare` → `strip:opennext-secrets` → `verify:opennext-secrets` |
| 4 | Cloudflare production rate-limit / fail-closed | **Done** | `src/lib/rate-limit.ts` + KV_STORE; tests in `rateLimit` / phase63 |
| 5 | Login without interactive Prisma `$transaction` on D1 | **Done** | `withRlsBypass` / auth path fix (`8ec77ec`) |
| 6 | jsPDF critical CVEs | **Done** | `jspdf@^4.2.1` |
| 7 | High/critical npm audit clean | **Done** | Removed `to-ico`; pure PNG→ICO in `generate-app-icons.mjs`; `npm audit --audit-level=high` → 0 |
| 8 | D1 binding declared + resolved | **Done** | `wrangler.toml` `DB` → `merlinus-d1`; `src/lib/d1.ts` OpenNext ALS / binding resolution |

### P0 verification commands

```bash
npm ci
npm test                          # unit suite
npm run test:integration          # 40 integration tests
npm run build                     # next + OpenNext + strip + verify
npm run verify:opennext-secrets
npm audit --audit-level=high
```

---

## P1 — First rooftop / storage migration (COMPLETE)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | R2 object storage (replace Vercel Blob runtime path) | **Done** | `src/lib/storage/{objectStorage,r2}.ts`, blob/video routes |
| 2 | Workers KV for distributed rate limit | **Done** | `src/lib/storage/workersKv.ts`, `KV_STORE` binding |
| 3 | Unit suite aligned to R2 + KV_STORE | **Done** | scan/rate-limit/blob tests; video `contentType` fix |
| 4 | D1-only Prisma (ignore stale Postgres URLs) | **Done** | `src/lib/apex/databaseConfig.ts` + unit tests |
| 5 | Driver adapters for Node CI + Workers | **Done** | `@prisma/adapter-d1`, `@prisma/adapter-better-sqlite3` / file path |
| 6 | Owner onboard dealership (+ optional owner) | **Done** | provision / national shell onboard UI commits |
| 7 | Owner national cold-start hardening | **Done** | `/api/owner/warmup`, `clientFetchRetry`, national shell keep-alive, RO list retries |

### Cold-start path smoke (local)

National owner flow statuses (no 5xx):

```text
login:200 → warmup:200 → summary:200 → enter-dealership:200 → ro-list:200
```

---

## P2 — Enterprise contract (PARTIAL / IN PROGRESS)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Security fortress owner least-privilege | **Done** | Phase 6.x integration: national PII block, enter/exit scope |
| 2 | Tenant isolation integration suite | **Done** | `tests/integration/tenant-isolation.test.ts` |
| 3 | Gitleaks on every push/PR | **Done** | CI job **Gitleaks secret scan** (`gitleaks/gitleaks-action@v2`) |
| 4 | Full Workers observability (audit window) | **Done** | `wrangler.toml` `[observability]` + logs + traces `enabled = true` |
| 5 | MFA (WebAuthn/TOTP) for owner/manager | **Deferred** | P2 residual — schedule post-audit |
| 6 | Encryption key rotation runbook + job | **Partial** | Dual-key encryption exists; formal rotation ops still P2 |
| 7 | D1 backup/DR runbook | **Deferred** | Ops doc + Cloudflare snapshot policy |

---

## P3 — Hardening depth (PARTIAL)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Client fetch retries + jitter on cold-start 500 | **Done** | `networkErrors.ts`, `clientFetchRetry.ts`, `api.ts` GET 500 retry |
| 2 | Session probe retries | **Done** | `loginSession.ts` |
| 3 | Membership-required refresh (no bare dealership FK) | **Code present (uncommitted residual)** | Prefer land `apexSession.ts` membership guard in follow-up if not already on branch tip |
| 4 | `__Host-` cookies / SameSite=Strict refresh | **Deferred** | Cookie surface review post-audit |
| 5 | Continuous SCA gate in CI | **Partial** | Local/gate documented; optional `npm audit` job can be added next |

---

## CI gates (current workflow)

From `.github/workflows/ci.yml` (parallel where noted):

| Job | Purpose |
|-----|---------|
| **Gitleaks secret scan** | Independent; fails on any finding; full history checkout |
| **quality** | Lint, typecheck, unit, seed, integration, production build, strip/verify OpenNext, ready-to-deploy |
| **OpenNext secret bake gate** | Independent OpenNext build + strip + verify (does not wait on unit tests) |

### Reference green runs (feature branch)

| Run | Commit | Notes |
|-----|--------|-------|
| Unit + integration (local) | `7b76ee4` / adapter work | 40/40 integration; unit green after adapter path fix |
| OpenNext + Gitleaks | `061ed3b` CI | Gitleaks **success**; OpenNext secret gate **success** |
| Unit regression | `061ed3b` CI | **1 fail** H15 package script assertion (fixed in this PR pack) |

After the H15 test update ships, quality should restore **full green** (unit 909/909, integration 40/40, build, gitleaks, secret bake).

---

## Dependency / SCA posture

| Finding class | Action |
|---------------|--------|
| `to-ico` → jpeg-js / minimist / url-regex | **Removed** package; pure ICO writer in `scripts/generate-app-icons.mjs` |
| `jspdf` critical | **Upgraded** to `^4.2.1` |
| `@supabase/supabase-js` | **Upgraded** to `^2.110.7` (still used by health probe path) |
| High/critical audit | **Clean** (`npm audit --audit-level=high` exit 0) |
| Moderate residual | Nested `postcss` under `next` — not fixable without breaking Next pin; track upstream |

---

## Runtime architecture (audit-relevant)

```text
Browser → Cloudflare Worker (OpenNext)
            ├─ D1 binding DB          (Prisma + @prisma/adapter-d1)
            ├─ R2 binding APEX_R2     (object storage)
            ├─ KV binding KV_STORE    (rate limit)
            └─ Secrets via wrangler   (never baked into next-env.mjs)
```

Local/CI Node uses **file SQLite** + `@prisma/adapter-better-sqlite3` with schema-relative path resolution matching Prisma CLI.

---

## Owner first-paint hardening (P1/P3)

| Component | Behavior |
|-----------|----------|
| `GET /api/owner/warmup` | Owner auth + `SELECT 1`; skip rate limit; no RLS |
| National shell | Warm before summary; rooftop prefetch; 3 min keep-alive + visibility resume |
| Enter dealership | Retry POST 500; warm after enter |
| RO list | App-level retries on 408/429/5xx before error UI |
| `fetchJsonWithClientRetry` | GET retries bare 500; optional POST for enter/exit |

---

## Residuals / do-not-claim

1. **MFA / SSO** not shipped.  
2. **Formal DR runbook** and automated D1 backups not in this PR.  
3. **Cookie `__Host-` / Strict** not fully rolled out.  
4. **Uncommitted local WIP** (env scripts, productionRuntime experiments, public icon regenerations) is **out of scope** for the pre-audit PR unless explicitly cherry-picked.  
5. Production **must** set real `GROK_API_KEY`, encryption keys, `MERLIN_PRODUCTION=1`, R2/KV bindings, and **delete** bootstrap seed secrets after onboard.

---

## Recommended auditor checklist

- [ ] Clone PR branch; `npm ci` && `npm test` && `npm run test:integration`  
- [ ] `npm run build` && confirm `verify:opennext-secrets` OK  
- [ ] Confirm CI: Gitleaks + quality + OpenNext secret gate all green  
- [ ] `npm audit --audit-level=high` exit 0  
- [ ] Review `wrangler.toml` observability enabled for audit window  
- [ ] Spot-check Worker secrets inventory (no secrets in git)  
- [ ] Smoke: national login → summary → enter rooftop → RO list (no 5xx on first paint)  

---

## Related documents

- `docs/ENTERPRISE-HARDENING-ROADMAP.md` — P0–P5 prioritization  
- `docs/Security-Fortress.md` — scope isolation model  
- `docs/Hardening-Final-Report.md` — historical hardening notes  

---

## Sign-off block (for audit period)

| Role | Name | Date | Notes |
|------|------|------|-------|
| Engineering | | | Pre-audit report + green CI |
| Ops / Deploy | | | Secrets set; seed secrets removed |
| Security review | | | External audit window |

*End of pre-audit hardening report.*
