# Self-heal & nightly maintenance

**Purpose:** After-hours ops for pilot → production. Grok analyzes live health signals and stores operator recommendations. **Never auto-edits application source.**

## Env (Cloudflare Worker secrets / vars)

| Variable | Value | Notes |
|----------|-------|--------|
| `GROK_SELF_HEAL_ENABLED` | `true` | Turns on Grok analysis during maintenance runs |
| `GROK_API_KEY` | (existing) | Required for analysis + morning Grok warmup |
| `NEXT_PUBLIC_SENTRY_DSN` | (existing) | Error capture; self-heal uses health matrix primarily |
| `OPS_MAINTENANCE_SECRET` | strong random | Bearer for cron; falls back to `AI_QUEUE_CONSUMER_SECRET` |
| `MERLIN_MAINTENANCE_TZ` | `America/New_York` | Wall-clock window timezone |
| `MERLIN_NIGHTLY_WINDOW_START` | `20` | 8pm local |
| `MERLIN_NIGHTLY_WINDOW_END` | `6` | 6am local — **shrink** as home usage grows (e.g. 22→5) |
| `MERLIN_NIGHTLY_SOFT_MAINTENANCE` | `true` | Soft ops flag only — does **not** block bay AI |

Full shop-floor AI block remains **`MERLIN_MAINTENANCE_MODE`** (operator-only).

## Endpoints

| Route | Auth | Role |
|-------|------|------|
| `POST /api/ops/nightly-maintenance` | Bearer ops secret | Cron / companion worker |
| `GET /api/ops/nightly-maintenance` | Bearer ops secret | Latest reports |
| `GET /api/ops/self-heal` | Manager session | Control Center status |
| `POST /api/ops/self-heal` | Manager session | Manual run now |

## Companion cron worker

```bash
npx wrangler deploy -c workers/ops-cron/wrangler.toml
echo https://YOUR_HOST | npx wrangler secret put APP_BASE_URL -c workers/ops-cron/wrangler.toml
echo "$OPS_MAINTENANCE_SECRET" | npx wrangler secret put OPS_MAINTENANCE_SECRET -c workers/ops-cron/wrangler.toml
```

Default crons (UTC): `20 0 * * *` (nightly ≈ 8:20pm EDT), `5 10 * * *` (morning ≈ 6:05am EDT).

## Manager UI

**Control Center → Health** shows last nightly report, Grok recommendations, and morning warmup probes. **Run now** triggers a manual pass.

## Shrinking the window

As technicians use the app later at home:

1. Raise `MERLIN_NIGHTLY_WINDOW_START` (e.g. 20 → 22)
2. Lower `MERLIN_NIGHTLY_WINDOW_END` (e.g. 6 → 5)
3. Move ops-cron schedules later / shorter
