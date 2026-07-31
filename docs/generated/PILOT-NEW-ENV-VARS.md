# Pilot — new environment variables (batch paste)

Generated: 2026-07-31T05:22:53Z

**File for bulk paste:** [`pilot-new-env-vars.env`](./pilot-new-env-vars.env)

This sandbox **cannot** write to your Cloudflare account (Wrangler not logged in).  
Use the table below once in the dashboard, or run the wrangler commands from a machine that is logged in.

## Main Worker `merlinus-platform`

| Variable | Suggested value | Type | Notes |
|----------|-----------------|------|--------|
| `GROK_SELF_HEAL_ENABLED` | `true` | Var | Turn on nightly Grok analysis |
| `GROK_SELF_HEAL_MODEL` | `grok-3-mini` | Var | Optional model |
| `MERLIN_MAINTENANCE_TZ` | `America/New_York` | Var | Window timezone |
| `MERLIN_NIGHTLY_WINDOW_START` | `20` | Var | 8pm local |
| `MERLIN_NIGHTLY_WINDOW_END` | `6` | Var | 6am local — shrink later |
| `MERLIN_NIGHTLY_SOFT_MAINTENANCE` | `true` | Var | Soft flag only; does **not** block bay AI |
| `OPS_MAINTENANCE_SECRET` | *(see .env file — generated)* | **Secret** | Cron bearer; also on ops-cron |
| `APEX_ALLOW_HTTP_PROVISION` | `true` | Var/Secret | National onboard form |
| `BILLING_PLATFORM_MONTHLY_CENTS` | `29900` | Var | $299/mo platform |
| `BILLING_STORY_FIRST_CENTS` | `95` | Var | $0.95 first story |
| `BILLING_STORY_HIGH_VOLUME_CENTS` | `65` | Var | $0.65 high volume |
| `BILLING_HIGH_VOLUME_THRESHOLD` | `400` | Var | Stories/period for HV rate |
| `BILLING_STORY_REGEN_CENTS` | `25` | Var | $0.25 regen |
| `BILLING_SMS_CENTS` | `4` | Var | $0.04 SMS |
| `BILLING_CURRENCY` | `USD` | Var | |

### Do **not** set yet (unless ready)

| Variable | Why |
|----------|-----|
| `MERLIN_MFA_ENFORCE=true` | Only after every manager/owner has enrolled MFA |
| `APEX_PROVISION_SKIP_READINESS=true` | Break-glass only — skips pilot readiness gate |
| `MERLIN_MAINTENANCE_MODE=true` | Full AI block — operator emergency only |

## Companion Worker `merlinus-ops-cron`

| Variable | Value |
|----------|--------|
| `APP_BASE_URL` | Your live app URL, e.g. `https://merlinus….workers.dev` |
| `OPS_MAINTENANCE_SECRET` | **Same** as main Worker |

## Already required (not new — confirm still present)

`GROK_API_KEY`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_HMAC_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, D1/KV/R2 bindings, `AI_QUEUE_CONSUMER_SECRET` (if queue consumer used).

## Dashboard bulk path (fastest)

1. Open Cloudflare → Workers & Pages → **merlinus-platform** → Settings → Variables and Secrets  
2. Open [`pilot-new-env-vars.env`](./pilot-new-env-vars.env)  
3. Add each line as **Variable** (or **Secret** for `OPS_MAINTENANCE_SECRET`)  
4. Redeploy Worker after secrets change  
5. Deploy ops-cron and set its two secrets  

## Wrangler (from your laptop, after `wrangler login`)

```bash
# Plaintext vars (example)
npx wrangler secret put OPS_MAINTENANCE_SECRET   # paste generated secret
# For non-secret vars, use dashboard or wrangler versions secret bulk / vars — CF dashboard is simpler for many flags.
```

Generated OPS secret is only in `pilot-new-env-vars.env` on this machine/commit — treat as sensitive if you push that file; rotate if exposed.
