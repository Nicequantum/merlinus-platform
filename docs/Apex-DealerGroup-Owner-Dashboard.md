# Apex DealerGroup & Group Owner Dashboard

**Status:** Complete (PR-G1 → PR-G5)  
**Audience:** Platform operators, franchise group owners, product  
**Related:** [Apex-National-Platform.md](./Apex-National-Platform.md) · [Apex-Dealer-Onboarding.md](./Apex-Dealer-Onboarding.md) · [Security-Fortress.md](./Security-Fortress.md)

---

## What is a DealerGroup?

A **DealerGroup** is the ownership / franchise portfolio layer above brand `Dealer` rows:

```text
DealerGroup  "Viti Automotive Group"  (legal: Viti, Inc.)
├── Dealer VITIMB     → Dealership "Mercedes-Benz of Tiverton"
└── Dealer VITIVOLVO  → Dealership "Viti Volvo of Tiverton"
```

| Concept | Model | Example |
|---------|--------|---------|
| Portfolio | `DealerGroup` | VITI-AUTO |
| Brand unit | `Dealer` | VITIMB, VITIVOLVO |
| Physical store | `Dealership` | Mercedes-Benz of Tiverton |
| Group owner access | `DealerGroupMembership` | James Gray → VITI-AUTO |

---

## Seed example (Viti)

| Field | Value |
|-------|--------|
| Code | `VITI-AUTO` |
| Name | Viti Automotive Group |
| Legal | Viti, Inc. |
| Linked dealers | `VITIMB`, `VITIVOLVO` (when present) |
| Group owner username | `viti.james.gray` |
| Password env | `VITI_AUTO_OWNER_PASSWORD` |

```bash
# PowerShell
$env:VITI_AUTO_OWNER_PASSWORD = "your-strong-password"
npm run db:seed
```

Optional overrides: `VITI_AUTO_OWNER_USERNAME`, `VITI_AUTO_OWNER_EMAIL`, `VITI_AUTO_OWNER_NAME`.

---

## Owner login & session scopes

| Scope | Who | Sees |
|-------|-----|------|
| **`group`** | Owner with `DealerGroupMembership` | Portfolio metrics + rooftops in group only |
| **`national`** | Platform owner (no memberships) | All rooftops on the platform |
| **`dealership`** | After **Enter rooftop** | Bay PII for that store only |

```text
viti.james.gray + password
  → scopeMode: group · activeDealerGroupId · dealerGroupName
  → dashboard (no PII)
  → Enter rooftop (VITIMB or VITIVOLVO only)
  → scopeMode: dealership
  → Exit → back to group home
```

Platform owners still sign in with **email** and land in **national** scope.

---

## Dashboard metrics

### Tier 1 — Portfolio health

Rooftops active · Brands/dealers · Active staff · RO volume (7d/30d) · Stories certified (7d/30d) · Adoption rate · Attention flag count

### Tier 2 — Trends & performance

| Metric | Notes |
|--------|--------|
| Volume trend | 7d vs prior 7d + 14-day sparkline |
| Certification rate | Certified stories ÷ RO volume (7d) |
| Time-to-certify | Median hours RO create → cert (30d sample) |
| AI usage (7d) | `UsageLog` hits |
| Login health | `auth.login` count + password gates |
| Staff depth | Managers / techs / advisors per rooftop |

### Tier 3 — Risk, compliance & exceptions

Flags are **PII-free** and categorized:

| Category | Examples |
|----------|----------|
| **Ops** | No RO activity, stale rooftop, volume cliff, empty portfolio |
| **Risk** | No staff, no manager, single-manager coverage |
| **Compliance** | Password change pending, no logins in 7d |
| **Quality** | ROs without certs, low cert rate, AI without output, slow time-to-certify |

Rooftop scoreboard sorts **attention → watch → healthy**.

---

## Security model

- Group home and national home: **aggregates only** (no VIN, RO numbers, customer names, story text).
- Enter dealership: audited (`owner.dealership_enter`); group owners may only enter rooftops under their group dealers.
- Exit: returns to **group** home when membership exists.
- Summary API: fail-closed — compute errors and audit write failures return errors (no silent partial metrics without audit).

Code map:

| Piece | Path |
|-------|------|
| Schema | `DealerGroup`, `DealerGroupMembership`, `Dealer.dealerGroupId` |
| Seed | [`src/lib/apex/seedDealerGroups.ts`](../src/lib/apex/seedDealerGroups.ts) |
| Access | [`src/lib/apex/dealerGroupAccess.ts`](../src/lib/apex/dealerGroupAccess.ts) |
| Session | [`src/lib/apex/ownerDealershipContext.ts`](../src/lib/apex/ownerDealershipContext.ts) |
| Metrics | [`src/lib/apex/ownerNationalSummary.ts`](../src/lib/apex/ownerNationalSummary.ts) |
| UI | [`src/components/apex/ApexOwnerNationalShell.tsx`](../src/components/apex/ApexOwnerNationalShell.tsx) |

---

## PR history

| PR | Deliverable |
|----|-------------|
| G1 | Schema, migration, VITI-AUTO seed, James Gray username owner |
| G2 | `scopeMode: group`, filtered dealership list, enter guards |
| G3 | Tier 1 metrics + rooftop comparison cards |
| G4 | Tier 2 trends, sparklines, staff depth, login health |
| G5 | Tier 3 flags, UX polish, docs, pre-rollout gate |

---

## Verification

```bash
npm run typecheck
npm test -- tests/unit/dealerGroup.test.ts tests/unit/dealerGroupScope.test.ts tests/unit/ownerGroupDashboard.test.ts
npm run validate:pre-rollout
npm run dev:apex
# Login: viti.james.gray
```

---

*Finalized with PR-G5.*
