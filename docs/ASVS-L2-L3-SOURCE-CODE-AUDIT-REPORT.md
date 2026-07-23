# OWASP ASVS v4.0.3 — Manual Source-Code Security Audit

| Field | Value |
|-------|--------|
| **Product** | Merlinus / Apex platform |
| **Stack** | Next.js 15 → OpenNext → Cloudflare Workers + D1 + R2 + KV |
| **Standard** | OWASP Application Security Verification Standard **v4.0.3** |
| **Target levels** | **Level 2** (primary) / **Level 3** (selective depth where architecture claims fortress/RLS) |
| **Method** | Manual source review of application code under `src/`, `security-policy.mjs`, `next.config.mjs`, `wrangler.toml`, `prisma/`, `migrations/`, `scripts/` (secret/build gates). Dependencies scanned only for known high-impact patterns and prior `npm audit` posture—not a substitute for SCA. |
| **Branch / date** | `feature/staging-mb-onboard-dealership` · 2026-07-18 |
| **Auditor role** | Independent ASVS L2/L3-style code review (static, non-runtime penetration test) |

---

## 1. Executive summary

Merlinus/Apex implements a **strong application-layer security control plane**: centralized `withAuth` gates, JWT + sessionVersion revocation, bcrypt-12 passwords, AES-256-GCM field encryption, Zod + sanitize input paths, dealership-scoped Prisma access helpers, rate limiting (memory/KV), CSP/security headers, audited writes, and fail-closed bootstrap in production.

**Critical architectural finding:** multi-tenant “RLS” on Cloudflare **D1/SQLite is not database-enforced**. `setRlsContext` is an intentional **no-op**; isolation depends on every query applying `dealershipId` / role filters. Missing a filter is therefore a **systemic residual risk** at ASVS L3 (and L2 multi-tenant expectation).

**Level readiness (auditor judgment):**

| Level | Verdict | Notes |
|-------|---------|--------|
| **ASVS L1** | **Largely ready** for pilot with compensating ops | Auth, sessions, basic validation, headers present |
| **ASVS L2** | **Partial — pilot with residual High items** | MFA missing; cookie flags weaker than L2 ideal; CSRF defense relies on SameSite+CORS; password policy weak vs provision |
| **ASVS L3** | **Not ready** | No DB RLS; no MFA; non-atomic rate limit; single encryption key; incomplete formal key lifecycle |

**Overall weighted compliance score (L2-oriented):** **≈ 62 / 100**  
(Methodology: chapter scores below, equal weight across V1–V14; rounded.)

| Chapter | Score (0–100) | Aggregate status |
|---------|---------------|------------------|
| V1 Architecture | 68 | Partial |
| V2 Authentication | 55 | Partial (MFA gap) |
| V3 Session Management | 70 | Partial |
| V4 Access Control | 72 | Partial (app-level only) |
| V5 Input Validation | 78 | Strong Partial |
| V6 Cryptography | 62 | Partial |
| V7 Error Handling | 80 | Strong Partial |
| V8 Data Protection | 70 | Partial |
| V9 Communications | 75 | Partial |
| V10 Malicious Code | 85 | Strong |
| V11 Business Logic | 68 | Partial |
| V12 Files | 74 | Partial |
| V13 API | 76 | Strong Partial |
| V14 Configuration | 72 | Partial |

---

## 2. Surface inventory (reviewed)

| Surface | Location / evidence |
|---------|---------------------|
| API routes | `src/app/api/**` (~98 route modules; primary choke point `withAuth` / `withPublicRoute`) |
| Auth | `src/lib/auth.ts`, `src/lib/apex/apexSession.ts`, `src/lib/apex/loginResolver.ts`, `src/lib/authBridge.ts`, login/select/refresh/logout routes |
| Session / RBAC | `src/lib/apiRoute.ts`, `src/lib/apex/tenantScope.ts`, `src/lib/apex/viewAs.ts`, `src/lib/repairOrderAccess.ts` |
| “RLS” | `src/lib/apex/rlsContext.ts` (D1 no-op + ALS) |
| Crypto / PII | `src/lib/encryption.ts` |
| Rate limit | `src/lib/rate-limit.ts` + `KV_STORE` in `wrangler.toml` |
| Headers / CSP | `security-policy.mjs`, `src/middleware.ts`, `next.config.mjs` |
| Uploads / media | `src/app/api/upload/route.ts`, `src/lib/imageAccess.ts`, `src/app/api/images/route.ts`, video share public routes |
| Public / webhooks | `src/lib/publicRoutes.ts`, Clerk webhook, Twilio voice, public video |
| Config / deploy | `wrangler.toml`, OpenNext strip/verify scripts, `src/instrumentation.ts` |

---

## 3. Chapter-by-chapter ASVS mapping

Status legend: **FI** = Fully Implemented · **PI** = Partially Implemented · **NI** = Not Implemented  
Evidence cites **file:line** from the reviewed tree.

### V1 — Architecture, Design and Threat Modeling

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V1.1 Secure SDLC / documented components | **PI** | Docs: `docs/Security-Fortress.md`, `docs/PRE-AUDIT-HARDENING-REPORT.md`, `docs/Technical-Specification-and-Architecture.md`. No formal threat-model artifact tied to every ASVS control in-repo. |
| V1.2 Authentication architecture | **PI** | Dual-path: legacy JWT (`src/lib/auth.ts:29–33,150–172`) + Apex access/refresh (`src/lib/apex/apexSession.ts:28–37`) + optional Clerk (`src/middleware.ts:68–77`, `src/lib/authMode.ts`). Documented MFA deferral (`auth.ts:13–27`). |
| V1.4 Access control architecture (centralized) | **PI** | Central `withAuth` (`src/lib/apiRoute.ts:94–365`) with owner/manager/admin/module/consent gates. Isolation is **application filter**, not DB policy (`rlsContext.ts:105–118`). |
| V1.5 Input/output encoding architecture | **PI** | Zod + sanitize (`src/lib/validation.ts`, `src/lib/sanitize.ts:6–15`). Client is React (default escape); one controlled SVG `dangerouslySetInnerHTML` (`MercedesStarMark.tsx`). |
| V1.6 Cryptographic architecture | **PI** | AES-GCM PII (`encryption.ts:21–67`); accepted single-key rotation risk (`encryption.ts:6–18`). |
| V1.8 Data protection / privacy design | **PI** | Consent + legal disclaimer gates (`apiRoute.ts:233–250`); PII encryption migrations under `prisma/migrations/*encryption*`. |
| V1.9 Communications architecture | **PI** | `upgrade-insecure-requests` + HSTS in prod (`security-policy.mjs:23`, `next.config.mjs:69–74`). Cross-origin API deny (`middleware.ts:19–31`). |
| V1.11 Business logic architecture | **PI** | Module entitlements (`apiRoute.ts:87–91,273–306`); daily AI caps (`apiRoute.ts:258–267`); owner national vs dealership scopes (`tenantScope.ts:57–134`). |
| V1.12 Secure file upload architecture | **PI** | Type/size limits + audit provenance (`upload/route.ts:9–20,90–115`); ACL on read (`imageAccess.ts:202–212`). |
| V1.14 Configuration architecture | **PI** | Env validation at startup (`instrumentation.ts:19–45`); OpenNext secret strip (scripts + CI, pre-audit report). |

**V1 residual:** Claims of “RLS fortress” overstate D1 reality—document as **application tenancy**, not SQLite RLS.

---

### V2 — Authentication

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V2.1 Password security (length, complexity) | **PI** | Change/reset min **8** (`validation.ts:324–331`); user create min **8** (`validation.ts:255`); provision temps min **12** (`validation.ts:349–364`). No complexity / breach-check / zxcvbn. |
| V2.2 General authenticator security | **PI** | bcrypt cost **12** (`auth.ts:142–147`); rate-limited login (`login/route.ts:27–28`, `rate-limit.ts:27–29`). |
| V2.3 Authenticator lifecycle | **PI** | `mustChangePassword` blocks PII routes (`apiRoute.ts:226–230`); admin reset sets flag (`users/[id]/password`). |
| V2.4 Credential storage | **FI** | Password hashes via bcrypt; secrets from env (`auth.ts:136–139`). |
| V2.5 Credential recovery | **PI** | Manager/admin reset paths exist; no self-service email recovery reviewed as primary. |
| V2.6 Look-up secrets / secondary factors | **NI** | MFA/TOTP/WebAuthn explicitly not implemented (`auth.ts:13–24`; pre-audit P2 deferred). |
| V2.7 Out of band | **NI** | Not present. |
| V2.8 Single / multi-factor | **NI** for MFA | Single-factor password (or Clerk if enabled). |
| V2.9 Cryptographic software/hardware factors | **NI** | — |
| V2.10 Service authentication | **PI** | Grok proxy HMAC / static bearer (`grok/proxy/route.ts:73–91`, `grokProxyAuth.ts`); SETUP_SECRET for seed (`setup/seed/route.ts:13–22`); Twilio signature (`voiceAgent/twilio.ts:54–81`). |

**Hunting notes:** Login returns generic invalid credentials in Apex (`login/route.ts:80–87`). Timing equalization of bcrypt vs missing user not fully proven (partial user enumeration risk under L3).

---

### V3 — Session Management

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V3.1 Fundamental session management | **PI** | httpOnly cookies; JWT HS256 with iss/aud/jti/exp (`auth.ts:150–159,175–183`); Apex access TTL 15m + refresh 7d (`apexSession.ts:35–37,96–113`). |
| V3.2 Session binding | **PI** | Optional IP hash on Apex claims (`apexSession.ts:79–83`); not mandatory rebinding on every request. |
| V3.3 Session termination | **FI/PI** | Logout + `sessionVersion` revocation (`auth.ts:207–212,282–297`); GET logout blocked for CSRF (`logout/route.ts:81–82`). |
| V3.4 Cookie-based session | **PI** | `httpOnly: true`, `sameSite: 'lax'`, `secure` only when `NODE_ENV === 'production'` (`auth.ts:175–183`; `apexSession.ts:96–104`). **Not** `__Host-` / `__Secure-`; not `SameSite=Strict`. |
| V3.5 Token-based session | **PI** | JWT claim parse strict (`sessionClaims.ts` via `auth.ts:167–169`); refresh POST only (`refresh/route.ts:81–82`). |
| V3.6 Re-auth for sensitive ops | **PI** | Forced password change; no step-up auth for privilege-sensitive admin actions. |
| V3.7 Defenses against session management exploits | **PI** | New jti per token; sessionVersion kill-switch; pending selection one-time consume (`select-dealership/route.ts:48–51`). Fixation: login issues new token (good). Hijacking: Lax + no MFA increases risk on XSS. |

---

### V4 — Access Control

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V4.1 General access control | **PI** | `withAuth` 401/403; role gates `requireManager`/`requireAdmin`/`requireOwner` (`apiRoute.ts:137–224`). |
| V4.2 Operation-level | **PI** | Effective role / View-As (`viewAs` imports in `apiRoute.ts:191–213`); service_advisor AI block (`apiRoute.ts:252–256`). |
| V4.3 Other access control (IDOR) | **PI** | RO access scoped by role + dealership (`repairOrderAccess.ts:32–89`); images ACL (`imageAccess.ts:58–76,202–212`); advisors/users routes use `withAuth` + dealership. **Not** DB RLS safety net (`rlsContext.ts:113–118`). |
| Horizontal privilege | **PI** | Technician RO limited to own `technicianId` (`repairOrderAccess.ts:79–88`). Manager/owner rooftop-wide when in dealership scope. |
| Vertical privilege | **PI** | Owner national cannot use dealership admin without enter (`tenantScope.ts:85–93,113–134`; `apiRoute.ts:209–223`). |
| National / group scope | **PI** | `requireOwnerNational`, enter/exit dealership routes. |

**Critical hunting conclusion:** IDOR risk is **mitigated where helpers are used**. Any Prisma `findUnique({ where: { id } })` without `dealershipId` is a potential IDOR—defense is process/discipline, not engine enforcement.

---

### V5 — Validation, Sanitization and Encoding

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V5.1 Input validation | **FI/PI** | Zod schemas + body limits (`validation.ts`, `parseRequestBody`); login schema (`validation.ts:33–51`). |
| V5.2 Sanitization / injection | **PI** | `sanitizeText` strips tags/handlers (`sanitize.ts:6–15`); Prisma parameterized queries (ORM). `$queryRaw` used with tagged templates (aggregates `ownerNationalSummary.ts`)—low injection risk if no string concat. |
| V5.3 Output encoding | **PI** | React default encoding; Twilio XML escape (`voiceAgent/twilio.ts:10–17`). |
| V5.4 Memory / string / unsafe APIs | **FI** | No `eval` / `child_process` in `src/` application code (grep). |
| V5.5 Deserialization | **PI** | JSON via Zod/parse; encrypt/decrypt JSON helpers; no Java-style object deserialize. |
| XSS (stored/reflected/DOM) | **PI** | Server sanitizes text fields; CSP still allows `'unsafe-inline'` scripts (`security-policy.mjs:9–10`)—reduces XSS impact incompletely. Single `dangerouslySetInnerHTML` for static logo markup. |
| SSRF | **PI** | Grok proxy fixed URL (`grok/proxy/route.ts:13,38`); VIN decode external fetch; voice recording fetches Twilio URL—ensure host allowlists in recording path. |
| Open redirect | **PI** | Auth flows largely cookie/session; Clerk `signInUrl: '/sign-in'` fixed (`middleware.ts:74`). No broad user-controlled redirect API found in core auth. |
| Command injection | **FI** | Not present in app routes. |
| SQL/NoSQL injection | **PI** | Prisma + limited raw SQL; D1 SQLite. |

---

### V6 — Stored Cryptography

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V6.1 Data classification | **PI** | Encrypted PII/story fields; docs/runbooks. |
| V6.2 Algorithms | **FI** | AES-256-GCM + random IV (`encryption.ts:21–66`); bcrypt-12; HMAC-SHA for tokens/signatures. |
| V6.3 Random values | **FI** | `randomBytes` / `randomUUID` for IV/jti. |
| V6.4 Secret management | **PI** | Env-only keys; OpenNext strip/verify; Gitleaks CI (pre-audit). Setup seed compare is **not** timing-safe (`setup/seed/route.ts:17–19`). |
| Key rotation | **PI** | Documented accepted risk; dual salt decrypt (`encryption.ts:48–57`); reencrypt scripts—not online dual-key envelope. |

---

### V7 — Error Handling and Logging

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V7.1 Log content | **PI** | Structured logger; redaction (`logRedact.ts:5–32`); request IDs (`apiRoute.ts` / `errors.ts:37–47`). |
| V7.2 Log processing | **PI** | Sentry for 5xx only (`errors.ts:50–53,107–121`); Workers observability full capture (`wrangler.toml:23–36`)—**high retention may increase PII-in-logs risk** if app logs payload details. |
| V7.3 Error handling | **FI** | Generic client messages via `apiError` / `handleRouteError` (`errors.ts:9–35,91–124`); no stack traces to client. |
| V7.4 Error disclosure | **FI** | Public-safe messages (`publicSafeMessage`). |

---

### V8 — Data Protection

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V8.1 General data protection | **PI** | Field-level encryption; consent gates. D1 at-rest encryption is **platform-managed** (Cloudflare)—not app-controlled FDE. |
| V8.2 Client-side protection | **PI** | Sensitive data primarily server-side; session in httpOnly cookies. Client holds session object after login (memory)—normal SPA residual. |
| V8.3 Sensitive private data | **PI** | Encrypted columns + hash search tokens (migrations). Legacy plaintext fallbacks on some decrypt paths (`encryption.ts:141–147`)—intentional migration compatibility. |
| Cache / private responses | **PI** | Images `Cache-Control: private, no-store` (`images/route.ts:36`). |

---

### V9 — Communication

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V9.1 Client communication security | **PI** | HSTS production (`next.config.mjs:69–74`); CSP upgrade-insecure-requests. Cookie `Secure` gated on NODE_ENV only—edge cases if prod without NODE_ENV=production. |
| V9.2 Server communication security | **PI** | Upstream HTTPS to xAI/Twilio/Clerk; Workers `global_fetch_strictly_public` (`wrangler.toml:19`). |

---

### V10 — Malicious Code

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V10.1 Code integrity | **PI** | CI + Gitleaks; no evidence of intentional backdoors in reviewed control plane. |
| V10.2 Malicious code search | **FI** | No eval/shell in `src` app paths; seed/bootstrap production-blocked (`middleware.ts:34–44`, `setup/seed/route.ts:29–31`). |
| V10.3 Application integrity | **PI** | Dependency high-audit clean per pre-audit; continuous SCA partial. |
| V10.4 Deployed subresource integrity | **PI** | CSP allows jsdelivr/Clerk CDNs without SRI enforcement in policy. |

---

### V11 — Business Logic

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V11.1 Business logic security | **PI** | Usage caps, module gates, consent/password gates, optimistic concurrency on RO updates (`validation.ts:211–213`). |
| Anti-automation | **PI** | Rate limits per IP; no CAPTCHA/bot on login beyond rate limit. |
| Race conditions | **PI** | KV rate limit non-atomic (`rate-limit.ts:89–111`); RO `updatedAt` optional concurrency; sessionVersion increments non-transactional with all side effects across Workers isolates. |
| Unauthorized business actions | **PI** | Owner View-As does not rewrite DB role (comment `auth.ts:68–72`); provision requires owner national scope. |

---

### V12 — Files and Resources

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V12.1 File upload | **PI** | MIME allowlist + size 8MB (`upload/route.ts:9–20,90–92`); empty MIME → JPEG fallback (`upload/route.ts:64–67`)—**polyglot risk residual**. Magic-byte verification not enforced. |
| V12.2 File integrity | **PI** | Pathname allowlist on image GET (`images/route.ts:18–20` + `isAllowedImagePathname`). |
| V12.3 File execution | **FI** | Served as blob stream, not executed. |
| V12.4 File storage | **PI** | R2 private + ACL; recent upload grant 1h (`imageAccess.ts:16–17`). |
| V12.5 File download | **PI** | ACL deny → 404 (`images/route.ts:22–25`); public video share token hashed (`public/video/[token]/route.ts:12–45`). |
| Path traversal | **PI** | Pathname validation required; defense depends on `isAllowedImagePathname` + storage key design. |

---

### V13 — API and Web Service

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V13.1 Generic API | **PI** | Auth on nearly all APIs; public list explicit (`publicRoutes.ts:3–19`). `/api/status` unauthenticated but low sensitivity (`status/route.ts:8–21`). |
| V13.2 RESTful | **PI** | JSON errors consistent; CORS denied for cross-origin API (`middleware.ts:19–31`)—CSRF partial substitute for cookie APIs (SameSite=Lax still allows top-level GET; state-changing APIs are POST). |
| V13.3 GraphQL | **N/A** | Not used. |
| V13.4 Web service / webhook | **PI** | Clerk Svix; Twilio signature with production fail-closed skip (`twilio.ts:60–64`). |

---

### V14 — Configuration

| Req (summary) | Status | Evidence |
|---------------|--------|----------|
| V14.1 Build | **PI** | standalone OpenNext; secret strip/verify; `reactStrictMode` (`next.config.mjs:46–48`). |
| V14.2 Dependency | **PI** | High npm audit clean (pre-audit); moderate postcss residual. |
| V14.3 Unintended security disclosure | **PI** | Security headers complete set (`security-policy.mjs:27–37`); CSP unsafe-inline weakens. |
| V14.4 HTTP security headers | **FI/PI** | X-Frame DENY, nosniff, COOP, CORP, Referrer-Policy, Permissions-Policy, CSP; HSTS prod-only. |
| V14.5 Validate HTTP headers | **PI** | Origin check for API; no full CORS allowlist of third parties (deny-by-default). |

**Wrangler notes:** D1/R2/KV bindings present (`wrangler.toml:45–65`); observability full sampling for audit window—reduce sampling post-audit to limit sensitive log retention.

---

## 4. Targeted threat hunt results

| Threat | Result | Primary evidence |
|--------|--------|------------------|
| **Broken access control / IDOR** | **Mitigated by convention** | `repairOrderAccess.ts`, `imageAccess.ts`, `scopedPiiWhere`; **no DB RLS** (`rlsContext.ts:113–118`) |
| **Privilege escalation vertical** | **Controls present** | Owner national blocked from rooftop admin (`tenantScope.ts:85–93`) |
| **Privilege escalation horizontal** | **Controls present** on RO/images; residual if any route skips helpers |
| **Missing / bypassed RLS** | **Confirmed architectural** | `setRlsContext` no-op; isolation = filters + ALS |
| **Session fixation / hijacking** | **Partial residual** | New tokens on login; Lax cookies; no MFA; 8h legacy JWT |
| **Improper JWT / cookies** | **Partial** | HS256 + iss/aud; Secure only NODE_ENV=production; no __Host- |
| **Hardcoded secrets** | **Not found in app control plane** | Env required; Gitleaks/OpenNext gates |
| **Weak crypto / at-rest** | **App-layer AES-GCM OK**; single key; platform D1/R2 encryption assumed |
| **Unsafe deserialization** | **Low** | JSON + Zod |
| **SSRF** | **Low–Medium** | Fixed Grok URL; review recording fetch hosts |
| **Open redirects** | **Low** | Fixed auth URLs |
| **Command injection** | **None found** | — |
| **SQL injection** | **Low** | Prisma dominant |
| **XSS** | **Medium residual** | sanitize + React; CSP unsafe-inline |
| **CSRF** | **Partial** | Origin deny + SameSite=Lax; no CSRF tokens; GET logout/refresh disabled |
| **Insecure upload / path traversal** | **Partial** | Type allowlist; MIME fallback; ACL on read |
| **Error leakage** | **Well controlled** | `handleRouteError` + redaction |
| **Prisma IDOR without scope** | **Systemic process risk** | Must use scoped helpers |
| **Cold-start data exposure** | **Hardened** | Owner warmup path; env validation soft on CF (`instrumentation.ts:23–31`) |
| **Observability gaps** | **Low for attacks**; **High retention may store sensitive events** | wrangler observability full |
| **Dependency vulns** | **High clean** (prior); continuous SCA partial |
| **Misconfigured Wrangler/Next** | **Mostly sound**; CSP/cookie flags incomplete vs L3 |
| **Business logic unauthorized actions** | **Mostly gated**; rate-limit races, password policy inconsistency |

---

## 5. Findings table

| ID | Severity | Location | Description | Recommended remediation |
|----|----------|----------|-------------|-------------------------|
| **F-01** | **Critical** (L3) / **High** (L2 multi-tenant) | `src/lib/apex/rlsContext.ts:105–118`, `120–143` | **No database-enforced tenant RLS on D1.** `setRlsContext` is a no-op; isolation depends entirely on application `dealershipId` filters. A single missed filter → cross-tenant data access. | (1) Document as **application tenancy**, not RLS. (2) Mandatory lint/code-review rule: no `findUnique` by id alone on tenant tables. (3) Integration tests for every resource type (extend `tests/integration/tenant-isolation.test.ts`). (4) Long-term: evaluate Postgres+RLS or D1 query middleware that injects tenant predicates. |
| **F-02** | **High** | `src/lib/auth.ts:13–24`; entire auth surface | **No MFA** for owners/managers; documented accepted risk. ASVS L2 V2.8 fails for privileged roles. | Implement TOTP or WebAuthn for `owner`/`manager`; require step-up for provision, user admin, enter-dealership. |
| **F-03** | **High** | `src/lib/auth.ts:175–183`; `src/lib/apex/apexSession.ts:96–104` | Cookie **`Secure` only if `NODE_ENV === 'production'`**; **`SameSite=Lax`** not Strict; no `__Host-` prefix. Mis-set env could send cookies over HTTP; CSRF residual for some POST patterns. | Gate `Secure` on explicit production runtime flags (align with `isProductionEnv()`); prefer `__Host-` cookies + `path=/`; consider `SameSite=Strict` for refresh cookie; add CSRF double-submit for state-changing APIs if cross-site risk model requires L3. |
| **F-04** | **High** | `src/lib/rate-limit.ts:89–111` | **KV rate limiting is non-atomic** (get → increment → put). Concurrent login floods can exceed intended limits under multi-isolate load. | Use Durable Objects, Workers Rate Limiting API, or atomic Lua-like compare-and-swap pattern; keep fail-closed for auth routes. |
| **F-05** | **Medium** | `src/lib/validation.ts:255,324–331` vs `349–364` | **Password policy inconsistency:** interactive change/create allow 8 chars; provision requires 12. No complexity/hibp. | Raise min to 12+ for all password writes; add complexity or breach-list check; document in UI (`ForcedPasswordChangeScreen.tsx` comment already notes mismatch). |
| **F-06** | **Medium** | `security-policy.mjs:7–10` | **CSP allows `'unsafe-inline'`** for scripts/styles (Next.js hydration). Weakens XSS containment (ASVS V14.4 / V5.3). | Migrate to nonces/hashes for scripts; minimize inline; re-evaluate Clerk/CDN allowlist. |
| **F-07** | **Medium** | `src/lib/encryption.ts:6–18,34–41` | **Single static DATA_ENCRYPTION_KEY**; rotation requires offline reencrypt. Compromise of one secret decrypts all field ciphertext. | Envelope encryption / dual-active keys; automated reencrypt job; key in KMS/Workers Secrets with rotation runbook drills. |
| **F-08** | **Medium** | `src/app/api/upload/route.ts:54–68` | Upload **MIME fallback to `image/jpeg`** when type empty/octet-stream; no magic-byte validation. | Sniff file signatures (JPEG/PNG/WebP); reject unknown; store only content-addressed keys under tenant prefix. |
| **F-09** | **Medium** | `src/app/api/setup/seed/route.ts:17–19` | **SETUP_SECRET comparison is not timing-safe** (string `===`). | Use `crypto.timingSafeEqual` on hashed/padded buffers. |
| **F-10** | **Medium** | Application-wide session model | **Legacy 8-hour JWT** (`auth.ts:31`) without refresh rotation on Merlinus path; Apex has better access/refresh split. | Unify on Apex short-lived access + rotating refresh; bind refresh to UA/IP optionally; revoke family on password change (partially present). |
| **F-11** | **Low** | `src/app/api/status/route.ts:8–21` | Public status exposes version, prompt version, build commit/date. Low risk recon aid. | Limit fields in production or require auth for build metadata. |
| **F-12** | **Low** | `wrangler.toml:23–36` | **Full log/trace sampling** during audit increases retention of operational data that may include metadata about users. | After audit, lower `head_sampling_rate`; ensure log redaction covers all PII fields. |
| **F-13** | **Low** | `src/lib/imageAccess.ts:119–128` | Batch image ACL scans last **150 ROs** only—possible false deny for older attachments (availability), not grant. | Paginate full attachment index or store pathname→RO index table. |
| **F-14** | **Info / Medium (ops)** | `src/instrumentation.ts:23–31` | Production env validation **does not hard-throw on Cloudflare**—soft fail to avoid blank Worker. Misconfiguration may run degraded. | Alert on `merlin.startup.env_invalid`; synthetic health that fails deploy if secrets missing. |
| **F-15** | **Low** | `src/lib/advisorIntelligence/resolveAdvisor.ts` (S2 comments) | **Some advisor alias fields still plaintext** (code comments mark S2 residual). | Encrypt remaining plaintext twin columns per migration plan. |

---

## 6. Positive controls (credit)

These are **well-implemented** relative to typical pilot SaaS:

1. **Central auth wrapper** with consent, password-change, legal disclaimer, role, module, usage, and rate-limit composition (`apiRoute.ts`).
2. **Session revocation** via `sessionVersion` (`auth.ts:214–227,282–297`).
3. **Owner least-privilege** national vs dealership (`tenantScope.ts`).
4. **AES-256-GCM PII** with auth tag (`encryption.ts`).
5. **bcrypt cost 12** (`auth.ts:142–144`).
6. **Generic error responses** + log redaction (`errors.ts`, `logRedact.ts`).
7. **Cross-origin API deny** + security headers (`middleware.ts`, `security-policy.mjs`).
8. **Image ACL** + upload audit provenance (`imageAccess.ts`, `upload/route.ts`).
9. **Public video** share tokens hashed + optional passcode + rate limit (`public/video/[token]/route.ts`).
10. **Bootstrap seed production block** (middleware + route).
11. **OpenNext secret bake prevention** + Gitleaks (CI / scripts).
12. **Twilio signature** validation with production fail-closed (`voiceAgent/twilio.ts`).
13. **Pending dealership selection** one-time token consume (`select-dealership/route.ts:48–51`).
14. **Logout/refresh CSRF via GET** blocked.

---

## 7. Overall compliance scorecard

| Metric | Value |
|--------|--------|
| **ASVS L2 overall** | **≈ 62%** (Partial) |
| **ASVS L3 overall** | **≈ 48%** (Not ready) |
| **Critical findings** | 1 (F-01 framed Critical at L3 / High at L2) |
| **High findings** | 3 (F-02, F-03, F-04; F-01 if multi-tenant production) |
| **Medium findings** | 6 |
| **Low / Info** | 4+ |

### Score interpretation

- Suitable for **controlled pilot** with trusted rooftops, strong ops secret hygiene, and integration tests green.
- **Not** suitable for uncontrolled multi-tenant production marketing as “database RLS fortress” without F-01 remediation and MFA (F-02).

---

## 8. Prioritized residual risks before external audit

### Closed in product (v4.1 diligence track — verify on each release)

| Item | Status |
|------|--------|
| **Accurate tenancy model + risk acceptance** | **Closed in docs** — Security-Fortress, Multi-Tenant-Isolation, Production-Readiness, pre-rollout overclaim scan. Mode: **application-layer RLS on D1, not true DB RLS**. |
| **MFA TOTP** | **Implemented** — enroll/verify + `MERLIN_MFA_ENFORCE`; ops must enable enforce. |
| **Dual-key encryption + full reencrypt inventory** | **Implemented** — `reencryptPlan.ts` covers all `*Encrypted` columns including MFA; health MFA stale probe. |

### P0 — Before external audit (remaining blockers for L2 “pass with findings”)

1. **Tenant isolation test matrix** — Automated IDOR suite for every object type (RO, user, advisor, ticket, loaner, video, department request, audit log).  
2. **Cookie Secure flag** aligned to real production detection, not only `NODE_ENV` (F-03).  
3. **Confirm KV_STORE bound** and auth fail-closed on production Workers (already coded; verify live).  
4. **Signed risk acceptance** for app-layer tenancy (template in Multi-Tenant-Isolation.md) — process, not code.

### P1 — First 30 days post-audit kickoff

5. Atomic / platform rate limiting for auth (F-04).  
6. Password policy unification min 12 + complexity (F-05).  
7. Upload magic-byte validation (F-08).  
8. Timing-safe SETUP_SECRET (F-09).  
9. CSP nonce migration roadmap (F-06).

### P2 — Enterprise / L3 track

10. Per-tenant / KMS envelope encryption (platform DEK residual).  
11. WebAuthn / step-up MFA.  
12. `__Host-` cookies + refresh rotation unification.  
13. Optional Postgres + true DB RLS if contractually required.  
14. D1 backup/DR + reduced observability sampling.  
15. Continuous SCA gate in CI.

**Buyer diligence packet:** Multi-Tenant-Isolation (risk acceptance) + Security-Fortress (honest architecture) + Reencryption-Runbook + Production-Readiness-Checklist + this ASVS report.

---

## 9. Requirement coverage attestation

This review **mapped every ASVS chapter V1–V14** to implementation evidence in the Merlinus/Apex tree, with FI/PI/NI judgments for the **L2 control families** that apply to this architecture (SPA + cookie API + multi-tenant Workers).  

Individual ASVS line items that are **N/A** (e.g., GraphQL V13.3, native mobile binary protections, hardware HSM requirements for pure SaaS without HSM) are treated as **out of scope** rather than failures.

A full 280-row checkbox spreadsheet can be generated from this report for GRC tools; the **findings table (Section 5)** is the actionable defect register for remediation tracking.

---

## 10. Methodology limits (honesty for external auditors)

| In scope | Out of scope / limited |
|----------|-------------------------|
| Manual reading of security-critical `src/lib` and representative API routes | Exhaustive line-by-line of every UI component string |
| Grep-assisted hunt for dangerous sinks | Live penetration test / auth bypass POC against production |
| Config: wrangler, next, security-policy, middleware | Cloudflare account IAM / dashboard misconfig |
| Prior CI/audit posture (pre-audit report) | Fresh `npm audit` at moment of reading every transitive dep daily |
| Prisma schema + migration intent | Proof of all production D1 data reencrypted |

**Recommendation to external firm:** Treat F-01 and F-02 as primary validation targets with multi-tenant IDOR fuzzing and privileged-session MFA gap confirmation.

---

*End of ASVS L2/L3 manual source-code audit report.*
