# Multi-tenant isolation (P3-1)

**Version:** 4.1.0 · **Updated:** 2026-07-22  
**Signable residual risk form:** [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md)

## Current production model (Cloudflare D1)

**Application-layer RLS on D1 with registry + Prisma extension. Not true DB RLS.**

Merlinus/Apex runs on **Cloudflare D1 (SQLite)**. SQLite has **no Postgres-style ROW LEVEL SECURITY**.

Isolation is **application-layer only**:

| Layer | Mechanism |
|-------|-----------|
| API | `withAuth` + dealership scope + module gates |
| DB access | `withSessionRls` + Prisma extension (`rlsPrismaExtension.ts`) |
| Registry | `rlsTenantRegistry.ts` — every tenant model must be registered |
| Gate | `npm run check:rls-registry` fails CI if schema drifts |

**Isolation mode id:** `application_layer_d1` (see `TENANT_ISOLATION_MODE` in code).

### Strengths

- Missed `where: { dealershipId }` still gets tenant predicates under enforced RLS context  
- `update`/`delete` rewritten to tenant-safe many-ops where needed  
- Platform tables explicitly listed as non-tenant  
- Apex never soft-opens via `RLS_ENABLED=false`

### Residual risk

- Call sites that use **bypass** / bare `getPrisma()` / `getRlsDb()` **outside** ALS without filters can cross tenants if misused  
- New models must be registered (enforced by CI)  
- **Not** a substitute for database-enforced policies under a hostile SQL client with the D1 connection string  
- Shared D1 database = noisy-neighbor and single data-plane credential blast radius

---

## Legal / compliance risk acceptance (buyer diligence)

By deploying Apex multi-tenant on D1, the customer and vendor acknowledge:

1. **Tenancy is application-enforced**, not database RLS.  
2. **Compensating controls** are: registry completeness CI, API default-deny wrappers, session scope, audited access, MFA for elevated roles, secrets hygiene on the Cloudflare account.  
3. **Residual risk:** a software defect that omits tenant context, or compromise of D1/Worker secrets, may expose multi-rooftop PII.  
4. **Not marketed as** “Postgres RLS fortress” or “database-enforced multi-tenant isolation.”  
5. **Optional future control:** migrate OLTP to Postgres with true ROW LEVEL SECURITY if contractually required (see below). Until then, this risk is **accepted** for pilot and multi-store under the compensating controls above.

Sign-off (print for deal packet):

| Role | Name | Date | Accept residual app-layer tenancy? |
|------|------|------|------------------------------------|
| Customer CISO / security | | | ☐ Yes |
| Customer legal / compliance | | | ☐ Yes |
| Vendor security owner | | | ☐ Yes |
| Fixed-ops director (ops impact understood) | | | ☐ Yes |

---

## True DB RLS (future — not on D1)

**Postgres RLS** (e.g. Supabase / Neon) would allow policies such as:

```sql
ALTER TABLE "RepairOrder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RepairOrder"
  USING (dealership_id = current_setting('app.dealership_id')::text);
```

### Prerequisites to adopt

1. Move primary OLTP from D1 to Postgres (large migration)  
2. Session GUC / connection-per-request with `SET LOCAL app.dealership_id`  
3. Dual-run app-layer + DB policies during cutover  
4. Re-validate all integrations (OpenNext Workers + Prisma adapter)

### Decision (2026)

**Stay on D1 app-layer isolation** for pilot and early multi-store. Revisit Postgres RLS only if:

- Enterprise buyer requires DB-enforced tenancy as a contractual control, or  
- Scale/analytics forces Postgres for other reasons  

Until then, treat **registry completeness + withSessionRls + Prisma extension** as the control plane — **not** database RLS.

---

## Operator checklist

- [ ] `npm run check:rls-registry` green before every deploy (**hard CI + pre-deploy gate**)  
- [ ] New Prisma models registered (DIRECT / RELATION / PLATFORM) — PR template requires this  
- [ ] Unit/isolation test for new PII models  
- [ ] No new control-plane queries without `withRlsBypass` intent review  
- [ ] Cross-tenant tests still pass (`tests/integration/tenant-isolation.test.ts`)  
- [ ] Docs and sales materials never claim current production uses Postgres/DB RLS  
- [ ] Risk acceptance signed before national multi-rooftop rollout  

### CSRF (session mutations)

Cookie-authenticated **POST/PUT/PATCH/DELETE** require double-submit: `merlin_csrf` cookie + `X-Merlin-CSRF` header (enforced via `withAuth` / bare auth routes; middleware seeds cookie).

### Companion / desktop live sync residual

Bay tablet ↔ Desktop Command Center: **last-write-wins** concurrent edits on the same RO line (no OT/CRDT). Unsaved dirty local edits pause full snapshot replace. Process: one active editor per line during certification peaks.

### Production MFA

**`MERLIN_MFA_ENFORCE=true`** is the production recommendation for manager/owner/admin after enrollment.  

