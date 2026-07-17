# Security Fortress (Phase 6.0) + Hardening Sprint (6.1–6.5) + Enterprise Cleanup (7.1–7.3)

**Status:** **Complete and production-ready** — Security Fortress (Phase 6.0) + Security Hardening Sprint (Phases 6.1–6.5) + **Enterprise Readiness Cleanup (Phases 7.1–7.3)**  
**Code baseline:** Phases 6.1–6.5 + **7.1–7.3** shipped; pre-rollout **APEX 6.1–6.5** gates green. Deploy with production KV + RLS + Phase 7.3 timezone/index migrations applied.  
**Audience:** Platform security, compliance, enterprise buyers, and operators  
**Default product mode:** Merlinus single-dealer remains the safe default; Apex enables multi-rooftop fortress controls.

---

## Goals

1. **Defense-in-depth tenancy** — Postgres RLS on PII tables, set per transaction via `app.*` session vars  
2. **Fail-closed compliance audits** — sensitive reads/writes must produce durable `AuditLog` rows  
3. **Owner least-privilege** — national owners cannot see dealership PII until enter-dealership  
4. **Session kill-switch** — credential change / logout / admin actions revoke JWT + apex refresh + Clerk  
5. **Enterprise credential hygiene** — no hard-coded owner secrets; create-only seed; explicit platform operators  

---

## Architecture

```
┌──────────────────┐     withAuth      ┌─────────────────────┐
│  API route       │ ───────────────►  │ requireDealership / │
│  (PII / owner)   │                   │ requireOwnerNational│
└────────┬─────────┘                   └──────────┬──────────┘
         │                                        │
         │ withSessionRls (default)               │
         ▼                                        ▼
┌──────────────────┐                   ┌─────────────────────┐
│ set_config LOCAL │                   │ writeAuditedAccess  │
│ app.rls_enforced │                   │ (fail-closed)       │
│ app.rls_soft_open│                   └─────────────────────┘
│ app.scope_mode   │
│ app.active_…_id  │
└────────┬─────────┘
         │ getRlsDb() / rlsTransaction() / withRlsBypass()
         ▼
┌──────────────────┐
│ Postgres FORCE   │
│ RLS policies     │
└──────────────────┘
```

### Key modules

| Module | Role |
|--------|------|
| [`src/lib/apex/rlsContext.ts`](../src/lib/apex/rlsContext.ts) | `withSessionRls`, `getRlsDb`, `rlsTransaction`, `withRlsBypass`, `setRlsContext` |
| [`src/lib/auditedAccess.ts`](../src/lib/auditedAccess.ts) | Fail-closed `writeAuditedAccess` |
| [`src/lib/auditMetadataSanitize.ts`](../src/lib/auditMetadataSanitize.ts) | Allowlist-only metadata; `hashRoNumberForAudit` |
| [`src/lib/apex/tenantScope.ts`](../src/lib/apex/tenantScope.ts) | Dealership / national owner guards |
| [`src/lib/apex/platformOperator.ts`](../src/lib/apex/platformOperator.ts) | Explicit platform operator allowlist (no “empty membership = superuser”) |
| [`src/lib/sessionRevocation.ts`](../src/lib/sessionRevocation.ts) | `revokeAllSessionsForTechnician`, scope-switch refresh drop |
| [`src/lib/grokProxyAuth.ts`](../src/lib/grokProxyAuth.ts) | Short-lived HMAC proxy tokens + timing-safe verify |
| [`src/lib/rate-limit.ts`](../src/lib/rate-limit.ts) | Distributed KV limits; Apex production fail-closed without KV |
| [`prisma/migrations/20250712120000_apex_phase6_1_rls_foundation/`](../prisma/migrations/20250712120000_apex_phase6_1_rls_foundation/) | ENABLE + FORCE RLS policies |
| [`prisma/migrations/20250715120000_apex_phase6_2_rls_default_deny/`](../prisma/migrations/20250715120000_apex_phase6_2_rls_default_deny/) | Default-deny soft-open + Technician / UsageLog RLS |

### Soft-open vs enforced (Phase 6.2+)

| Mode | Soft-open | Enforced |
|------|-----------|----------|
| **Apex** | Never (default-deny without tenant match / bypass) | On by default; `RLS_ENABLED=false` ignored |
| **Merlinus** | Soft-open when not forced | `RLS_ENABLED=true` forces enforce |

- Soft-open requires explicit `app.rls_soft_open=on` (not merely “enforced off”).  
- Control-plane (login, seed, national aggregates) uses `withRlsBypass`.  
- PII routes set `enforced: true` inside `withSessionRls` / `rlsTransaction`.

---

## Security Hardening Sprint (complete · production-ready)

| Phase | Theme | Highlights |
|-------|--------|------------|
| **6.1** | Owner credentials & session | No hard-coded owner passwords/emails; create-only seed; no login password heal; admin reset sets `mustChangePassword`; re-validate `ownerMayEnterDealership` on refresh; explicit platform operator allowlist |
| **6.2** | RLS default-deny + Grok proxy | Apex enforce-by-default; Technician/UsageLog/DealerGroupMembership RLS; short-lived Grok proxy HMAC tokens; timing-safe compare |
| **6.3** | Manager parity + audit + limits | Manager/admin auto dealership context + `getRlsDb`; allowlist-only audit metadata + RO hash; fail-closed `ro.list`; companion rate limits; production auth KV warnings |
| **6.4** | Finalize | Production KV guidance + boot warnings; MFA/SSO & pen-test roadmap; changelog + pre-rollout complete gates |
| **6.5** | Remaining items | Apex production **fail-closed** without KV; MFA/SSO **implementation guidance**; final pre-rollout gates (no hard-coded credentials, RLS default-deny) |

**Sprint status: complete and production-ready** (Phases 6.1–6.5).  
Engineering delivery is finished. Ops go-live still requires production KV, Supabase RLS migrations, and [Production-Readiness-Checklist.md](./Production-Readiness-Checklist.md) sign-off. Follow-on product work (not blocking code readiness): MFA/SSO delivery, independent pen test.

---

## Enterprise Readiness Cleanup (Phases 7.1–7.3) — **complete**

Post-hardening maintainability and multi-tenant scale pass. **Status: complete.**

| Phase | Theme | Highlights |
|-------|--------|------------|
| **7.1** | Consistency & scale | Migrate bare Prisma → `getRlsDb` / `withRlsBypass`; advisor metrics **90d** window; owner summary SQL day buckets; batched image access; national session only for platform operators; production weak-secret hard-fail; Zod JWT claim validation |
| **7.2** | Observability & test proof | Central log/Sentry redaction; Sentry only for **5xx**; rate-limit success → debug; request correlation IDs; Grok/Blob `reportMappedRouteError`; behavioral tests for 429, RLS contracts, session revoke, Clerk webhook |
| **7.3** | Future-proofing | Per-dealership IANA **timezone**; `withStoryAiRoute` + consistent `blockServiceAdvisorAi`; multi-group portfolio switcher; hot-path composite indexes |

**Modules added/extended:** [`logRedact.ts`](../src/lib/logRedact.ts), [`requestContext.ts`](../src/lib/requestContext.ts), [`storyAiRoute.ts`](../src/lib/storyAiRoute.ts), [`dealershipDayBoundary.ts`](../src/lib/dealershipDayBoundary.ts), owner `dealer-groups` / `select-dealer-group` APIs, migration `20250716120000_apex_phase7_3_timezone_indexes`.

**Cleanup status: complete.** Optional later: live Postgres RLS CI suite, coverage gates, browser E2E, MFA/SSO product delivery.

---

## Owner session model

| State | Allowed | Denied |
|-------|---------|--------|
| **National / group home** | `/api/owner/*`, enter-dealership (scoped rooftops) | RO/PII routes (`DEALERSHIP_CONTEXT_REQUIRED`) |
| **Dealership** | PII routes for active rooftop | National summary / dealership list / re-enter without exit |

- Platform-wide rooftop access requires **explicit** platform operator emails (`APEX_PLATFORM_OWNER_EMAILS` and/or `OWNER_SEED_EMAIL*`).  
- Group owners only see rooftops under their `DealerGroupMembership`.  
- Sentinel `__apex_national__` is never an enterable rooftop.  
- Enter / exit / multi-rooftop select revoke prior apex refresh families before re-issue.  
- Enter rights are re-checked on every owner dealership session rebuild (stale membership cut-off).

---

## Mandatory audit surfaces (non-exhaustive)

| Area | Actions (examples) |
|------|--------------------|
| Auth | `auth.login`, `auth.logout`, `auth.refresh`, `auth.select_dealership`, `auth.password_change`, `auth.clerk_link` |
| Owner | `owner.national_access`, `owner.dealership_enter`, `owner.dealership_exit` |
| Control plane | `dealer.provision` (PII-free metadata only) |
| RO / story | `ro.create`, `ro.read`, `ro.list`, `ro.update`, `ro.delete`, `ro.extract`, `story.*` |
| Compliance | `audit.access`, `image.upload`, `story.pdf_export` |
| Admin | `user.*`, `advisor.*`, `template.save` / `template.use` |

**Metadata policy:** allowlist-only; plaintext RO numbers hashed to `roNumberHash`; no free-text pass-through.

---

## Production rate limiting (Vercel KV)

| Setting | Requirement |
|---------|-------------|
| `KV_REST_API_URL` | **Required in production** — Upstash/Vercel KV REST URL |
| `KV_REST_API_TOKEN` | **Required in production** — REST token |

**Setup**

1. Vercel → Project → **Storage** → Create **KV** (Upstash) → Connect to project  
2. Confirm Production env has both variables  
3. Redeploy  

**Behavior by mode (Phase 6.5)**

| Environment | Missing / unhealthy KV |
|-------------|------------------------|
| **Apex + production** | **Fail closed** — `checkRateLimit` returns **503**; startup logs `rate_limit.apex_kv_required`; env validation treats KV as **required** (build/start fail when `throwOnError`) |
| **Merlinus + production** | Loud **`rate_limit.auth_kv_required`** / **`auth_kv_unavailable_fallback`**; in-memory fallback for availability |
| **Local / preview / CI** | In-memory fallback OK |

Startup also logs `rate_limit.kv_ready` when configured.

---

## Dealer provision (control plane)

| Control | Behavior |
|---------|----------|
| Engine | `provisionDealer()` in RLS-bypass transaction (`withRlsBypass`) |
| CLI | `npm run provision-dealer` — passwords never on argv |
| HTTP | `POST /api/owner/provision-dealer` only when `APEX_ALLOW_HTTP_PROVISION=true`; owner **national** scope |
| Audit | `dealer.provision` fail-closed; metadata allow-list (hashes/ids — no email, D7, rooftop name, password) |
| First login | `Technician.mustChangePassword` → API `PASSWORD_CHANGE_REQUIRED` until change-password |
| Session | Password change revokes JWT version + apex refresh + Clerk |

Full operator runbook: [Apex-Dealer-Onboarding.md](./Apex-Dealer-Onboarding.md).

---

## Session revocation matrix

| Event | sessionVersion | Apex refresh | Clerk |
|-------|----------------|--------------|-------|
| Logout | yes | yes | active + linked |
| Password change (self) | yes | yes | linked |
| Forced password change (provision) | yes | yes | linked |
| Admin password reset | yes | yes | linked (+ `mustChangePassword`) |
| User deactivate / delete | yes | yes | linked |
| Owner enter / exit | — | yes (scope switch) | — |
| Multi-rooftop select | — | yes (scope switch) | — |

---

## MFA / SSO — implementation guidance (Phase 6.5)

Compensating controls today (until MFA/SSO ship): create-only owner seed, no hard-coded secrets, session revocation, distributed rate limits (Apex fail-closed without KV), fail-closed audits, platform operator allowlist.

### MFA for platform operators (recommended first)

| Step | Guidance |
|------|----------|
| 1. Scope | `role=owner` accounts listed in `APEX_PLATFORM_OWNER_EMAILS` / `OWNER_SEED_EMAIL*` |
| 2. Provider | Prefer **Clerk** MFA (TOTP + WebAuthn) when `AUTH_MODE=dual` or `clerk`, or IdP MFA enforced at Okta/Azure AD |
| 3. Policy | Block national console and enter-dealership until MFA satisfied (session claim `mfa: true` or Clerk `factorVerificationAge`) |
| 4. Recovery | Break-glass owners via hardware key + offline recovery codes stored in 1Password/Bitwarden enterprise vault |
| 5. Audit | Log `auth.mfa_challenge` / `auth.mfa_success` (fail-closed when MFA gated routes) |
| 6. Rollout | Stage: require MFA for new owners → production: enforce for all platform operators before multi-group GTM |

**Code hooks (future PR):** extend `resolveAppSession` / Apex access JWT with MFA claim; gate `requireOwner` / `requireOwnerNational` when claim missing.

### SSO (SAML / OIDC) for dealer groups

| Step | Guidance |
|------|----------|
| 1. IdP | Okta / Azure AD / Google Workspace enterprise app |
| 2. Broker | **Clerk** Enterprise Connections (SAML/OIDC) or native OIDC if Clerk not used |
| 3. Mapping | IdP groups → Apex `DealerGroupMembership` + rooftop roles (`manager` / `technician` / `service_advisor`) |
| 4. Linking | Existing `authProvider` / `clerkUserId` on `Technician`; keep D7 login for bay techs who lack IdP seats |
| 5. Provision | SCIM optional Phase 7+; until then JIT create on first SSO with manager approval |
| 6. Cutover | `AUTH_MODE=dual` during migration → `clerk` for groups that completed SSO |

**Code hooks (future PR):** Clerk webhook membership sync; map SAML attributes to `dealerGroupId` / rooftop codes.

### Independent pen test

| Item | Recommendation |
|------|----------------|
| **Scope** | Apex multi-tenant isolation, owner enter/exit, provision API (if enabled), auth brute-force, Grok proxy token path, RLS default-deny verification, KV fail-closed on Apex |
| **Timing** | After Phase 6.1–6.5 deploys + RLS migrations on production Supabase + production KV connected |
| **Evidence** | Written report; retest of Critical/High findings |

Until pen test: internal pre-rollout + fortress integration suite + this document as security baseline.

---

## Verification

```bash
npm run typecheck
npm test
npm run test:integration
npm run smoke:dealer-provision
npm run validate:pre-rollout
```

Security-focused suite: `tests/integration/security-fortress.test.ts`  
Provision suite: `tests/integration/dealer-provision.test.ts`  
Unit guards: `tests/unit/phase63Security.test.ts`, `tests/unit/phase63MediumHardening.test.ts`, `tests/unit/rlsContext.test.ts`, `tests/unit/provisionDealer.test.ts`

---

## Phase 6 PR checklist

| PR | Deliverable |
|----|-------------|
| 6.1 | Owner credential hygiene; enter re-validation; platform operator allowlist |
| 6.2 | RLS default-deny (Apex); Technician RLS; Grok proxy short-lived tokens |
| 6.3 | Manager `getRlsDb` parity; audit allowlist; `ro.list`; companion rate limits; auth KV warnings |
| 6.4 | Production KV docs/boot logs; MFA/SSO + pen-test roadmap; changelog; pre-rollout complete gates |
| 6.5 | Apex production fail-closed without KV; MFA/SSO implementation guidance; final pre-rollout gates |

**Phase 6.0 Security Fortress: complete and production-ready.**  
**Security Hardening Sprint (6.1–6.5): complete and production-ready.**  
**Enterprise Readiness Cleanup (7.1–7.3): complete.**
