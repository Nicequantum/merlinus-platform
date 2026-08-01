# Second-facility pilot (same dealer, two rooftops)

**Audience:** Platform owner onboarding a Mercedes group with a second physical store.  
**Updated:** 2026-08-01

## Model

```
DealerGroup (one owner portfolio)
  ├── Dealer / rooftop A  (facility 1)
  └── Dealer / rooftop B  (facility 2)
```

Isolation is **per dealership** at the bay (RO, images, stories).  
The owner sees **both** under one national / group console after enter rights are set.

## How to provision facility 2

### Recommended (HTTP onboard)

1. Provision facility 1 with owner email (creates group + membership).
2. Provision facility 2 with a **new dealer code** and **same owner email**.
3. System **links** the owner and **attaches** the new franchise to their **primary dealer group** (`attachLinkedOwnerToPrimaryGroup: true` by default).
4. Enable modules **per rooftop** in Manager Control Center (nothing inherits automatically).

### Explicit group id

```json
{
  "existingDealerGroupId": "<group-id-from-facility-1>",
  "attachLinkedOwnerToPrimaryGroup": true,
  "owner": { "email": "same@…", "name": "…", "password": "…" }
}
```

### Owner workflow

- National / group home → **Enter** facility A → bay work  
- **Enter facility B directly** (rooftop→rooftop switch; no exit required)  
- **Exit** returns to national console (billing, onboard, portfolio)

### Staff who float between facilities

- Give each tech **TechnicianDealership** membership on both rooftops (manager roster / seed).
- Login multi-select, or mid-session: `POST /api/auth/switch-dealership` / `switchStaffDealership()`.

## Isolation checklist (day of pilot)

| Check | Pass criteria |
|-------|----------------|
| Tech A at store A | Cannot open store B RO by id |
| Owner enter A then B | RO lists differ; no cross-store bleed |
| Modules | Store B starts with product modules **off** until enabled |
| Billing | National billing shows **per rooftop** story counts |
| MFA | Managers enrolled before `MERLIN_MFA_ENFORCE=true` |

## What this does **not** do

- Does not enable DB-level RLS (app-layer tenancy remains).  
- Does not auto-copy module toggles from store A to B.  
- Does not merge two managers into one login across stores (each manager is per rooftop unless dual membership is granted).
