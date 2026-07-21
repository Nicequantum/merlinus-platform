# CDK Global live sync — deferred (P3-3)

## Status: **not shipping live API sync**

| Surface | Status |
|---------|--------|
| Module id `cdk_sync` | Catalog entry only; **default off**; deferred until credentials + legal |
| Clipboard / paste into CDK | **Available without module** (`sanitizeForCDK`, desktop companion “Copy for CDK”) |
| Live CDK Global API | **Not implemented** |

## Why deferred

1. **Credentials** — Dealer-specific CDK Global API keys and site codes are not in platform secrets by design until a signed integration path exists.
2. **Legal / OEM** — Data processor terms and DMS vendor agreements must be completed per rooftop.
3. **Scope** — Story/export quality for human paste is the current revenue path; bi-directional RO sync is a separate product track.

## Enabling later

1. Complete CDK partner onboarding and store credentials in **Worker secrets** (never in client bundles).
2. Implement connector under `src/lib/cdk/` (HTTP client, mapping, idempotency).
3. Gate all live routes with `requireModule: 'cdk_sync'`.
4. Manager toggle: only enable after connector health is green.
5. Update [Product-Modules.md](./Product-Modules.md) and provision templates.

## Current operator message

Manager dashboard already surfaces: *“Requires CDK API credentials (not configured yet).”*  
Code: `isCdkLiveSyncAvailable()` returns `false` until env + implementation land.

## Env (reserved — unused until go-live)

```bash
# CDK_GLOBAL_API_BASE=
# CDK_GLOBAL_CLIENT_ID=
# CDK_GLOBAL_CLIENT_SECRET=
# CDK_SITE_CODE=
```

Do not set these in production until the connector is implemented and reviewed.
