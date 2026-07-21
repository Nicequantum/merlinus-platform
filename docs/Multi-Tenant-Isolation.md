# Multi-tenant isolation (P3-1)

## Current production model (Cloudflare D1)

Merlinus/Apex runs on **Cloudflare D1 (SQLite)**. SQLite has **no Postgres-style ROW LEVEL SECURITY**.

Isolation is **application-layer**:

| Layer | Mechanism |
|-------|-----------|
| API | `withAuth` + dealership scope + module gates |
| DB access | `withSessionRls` + Prisma extension (`rlsPrismaExtension.ts`) |
| Registry | `rlsTenantRegistry.ts` — every tenant model must be registered |
| Gate | `npm run check:rls-registry` fails CI if schema drifts |

**Isolation mode id:** `application_layer_d1` (see `TENANT_ISOLATION_MODE` in code).

### Strengths

- Missed `where: { dealershipId }` still gets tenant predicates under enforced RLS
- `update`/`delete` rewritten to tenant-safe many-ops where needed
- Platform tables explicitly listed as non-tenant

### Residual risk

- Call sites that use **bypass** / bare `getPrisma()` without filters can cross tenants if misused
- New models must be registered (enforced by CI)
- Not a substitute for database-enforced policies under a hostile SQL client with the D1 connection string

---

## True DB RLS (future — not on D1)

**Postgres RLS** (e.g. Supabase / Neon) would allow:

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

Until then, treat **registry completeness + withSessionRls** as the control plane.

---

## Operator checklist

- [ ] `npm run check:rls-registry` green before every deploy
- [ ] New Prisma models registered (DIRECT / RELATION / PLATFORM)
- [ ] No new control-plane queries without `withRlsBypass` intent review
- [ ] Cross-tenant tests still pass (`tests/integration/tenant-isolation.test.ts`)
