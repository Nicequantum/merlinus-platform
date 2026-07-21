# Product modules (tier / rooftop entitlements)

The platform is **modular**: each dealership (rooftop) only sees and can call features that are enabled for their tier.

`core_story` (RO → AI warranty narrative) is **always on** and is **not** a product module.

---

## Canonical module ids

| Module id | Product name | What it unlocks |
|---|---|---|
| `video_mpi` | Video MPI | Record/upload inspections, customer reports, share/SMS |
| `maintenance` | Maintenance Management | Facility / shop tickets board |
| `voice_agent` | AI Voice Agents (Sophia + specialists) | Inbound phone AI, lines, call logs, voice ops |
| `calendar_hub` | Calendar & Conversation Hub | Appointments timeline, AI call insights, portal, hub analytics |
| `loaner` | Loaner fleet | Loaner inventory and assignments |
| `parts` | Parts department | Parts inbox |
| `sales` | Sales department | Sales inbox |
| `service` | Service department | Service inbox |
| `cdk_sync` | CDK Global Sync | Live CDK API (deferred; credentials required) |

### Env aliases (break-glass only)

Prefer **Manager Dashboard → Modules** or `MODULES_FORCE_ENABLE`.

| Alias | Maps to |
|---|---|
| `MODULE_HUB_ENABLED=true` | force-enables `calendar_hub` |
| `MODULE_VOICE_ENABLED=true` | force-enables `voice_agent` |
| `MODULES_FORCE_ENABLE=calendar_hub,voice_agent` | canonical multi-id force list |

Production should rely on **DealershipModule** rows, not force flags.

---

## Resolution order

1. `MODULES_FORCE_ENABLE` / boolean aliases (ops break-glass)  
2. `DealershipModule` for the active rooftop  
3. `DealerGroupModule` (group default)  
4. Default **off** (opt-in)

---

## How gating works

### Backend

- Authenticated routes use `requireModule: '<id>'` in `withAuth` → **403** `MODULE_DISABLED` when off.
- Public voice **inbound** already checks `ensureVoiceModuleEnabled` (`voice_agent`).
- Hub **call ingest** skips AI insight writes when `calendar_hub` is off (voice still works).
- Public customer portals (`/portal/*`, `/v/*`) stay available for already-issued links.

### Frontend

- Manager nav tiles for Voice / Calendar hub only render when the module is **enabled**.
- Module surfaces show `ModuleDisabledNotice` if opened while disabled.

---

## Enable for seed / staging rooftop

### Option A — Manager UI

1. Sign in as manager on the rooftop.  
2. **Manager Dashboard → Modules**.  
3. Enable **AI Voice Agents** (`voice_agent`).  
4. Enable **Calendar & Conversation Hub** (`calendar_hub`).

### Option B — D1 seed (staging)

```bash
# Enable calendar_hub for seed-dealership
npx wrangler d1 execute merlinus-d1 --remote --command "INSERT INTO DealershipModule (id, dealershipId, moduleId, enabled, configJson, enabledAt, createdAt, updatedAt) VALUES ('seed-mod-calendar-hub', 'seed-dealership', 'calendar_hub', 1, '{}', datetime('now'), datetime('now'), datetime('now'));"

# voice_agent is usually already on for seed; if not:
npx wrangler d1 execute merlinus-d1 --remote --command "INSERT INTO DealershipModule (id, dealershipId, moduleId, enabled, configJson, enabledAt, createdAt, updatedAt) VALUES ('seed-mod-voice-agent', 'seed-dealership', 'voice_agent', 1, '{}', datetime('now'), datetime('now'), datetime('now'));"
```

If the row exists, toggle with:

```bash
npx wrangler d1 execute merlinus-d1 --remote --command "UPDATE DealershipModule SET enabled = 1, updatedAt = datetime('now') WHERE dealershipId = 'seed-dealership' AND moduleId = 'calendar_hub';"
```

### Option C — New provision

`ensureDealershipModuleDefaults` seeds `SEED_ENABLED_MODULE_IDS`, which now includes **`calendar_hub`** and **`voice_agent`**.

---

## Future department voice agents

Specialists (Service, Parts, Sales, Finance, …) live under the **`voice_agent`** product module.  
They are **not** separate commercial modules unless product later splits SKUs—registry agents share the same entitlement.

See `docs/VOICE-AGENT-REGISTRY-AND-HUB.md`.
