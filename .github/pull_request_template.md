## Summary

<!-- What changed and why (1–3 sentences). -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Security / tenancy
- [ ] Docs / ops
- [ ] Refactor (no behavior change)

## Checklist

### Always

- [ ] `npm test` passes (mainline must be 100% green)
- [ ] `npm run typecheck` if TypeScript surfaces changed
- [ ] No secrets committed (`.owner-seed*`, passwords, keys)

### Prisma / multi-tenant (P0-3 / P0-5) — **required if schema or tenant models change**

> **Hard CI gate:** `npm run check:rls-registry` fails the build if any Prisma model with tenant fields (`dealershipId` / `activeDealershipId`) is unregistered, or any model is unclassified.

- [ ] New/changed models registered in `src/lib/apex/rlsTenantRegistry.ts`
  - Has `dealershipId` → `DIRECT_DEALERSHIP_MODELS`
  - Child of tenant row (no `dealershipId`) → `RELATION_SCOPED_MODELS` (parent relation field)
  - Platform/global only → `PLATFORM_NON_TENANT_MODELS`
- [ ] `npm run check:rls-registry` passes locally
- [ ] Unit or integration isolation coverage if the model holds PII or cross-rooftop risk
- [ ] No new `withRlsBypass` without intent review comment

### Modules / product SKUs

- [ ] Backend `requireModule` / department gate if new product surface
- [ ] Manager UI hidden when module disabled

### API routes (P0-4) + CSRF (P1)

- [ ] New routes use `withAuth`, `withPublicRoute`, or `withStoryAiRoute`
- [ ] Or documented on `INTENTIONAL_BARE_API_ROUTES` with compensating control
- [ ] Mutating routes rely on CSRF double-submit (`X-Merlin-CSRF` + `merlin_csrf`); `skipCsrf` only for signature/bearer webhooks
- [ ] `npm run check:api-routes` passes

### Secrets / production

- [ ] No `OWNER_SEED_PASSWORD*` left on production Worker after bootstrap
- [ ] `APEX_PLATFORM_OWNER_EMAILS` used for ongoing national operators
