# Pilot Data Export API — Setup & Access Guide

**Audience:** You (platform owner) + Google Cloud migration partners  
**Product:** Merlinus / Apex on Cloudflare Workers  
**Schema version:** `1.0.0`  
**Updated:** 2026-08-01  

This API lets your GCP container team pull **staging setup + live pilot telemetry** without passwords, warranty story text, customer names, VINs, or session secrets. It is built for a **month-long pilot** and for **onboarding two rooftops** under one owner group.

---

## What this is (simple language)

Think of each export URL as a **secure folder** on the internet:

1. Your team proves who they are (a long secret password called a **token**, or your owner login).
2. Merlinus hands back **JSON data** about the pilot (stores, how many stories, health, audit events).
3. They can ask for the **next page** of long lists using a `cursor`.

They do **not** get a dump of customer repair-order secrets. That keeps you compliant while still giving engineers everything they need to rebuild tenancy, metering, and ops on Google Cloud.

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/export/pilot` | **Catalog (manifest)** — list every dataset + rules |
| `GET` | `/api/export/pilot/{dataset}` | One dataset (paginated or snapshot) |

Replace host with your live Worker URL, e.g. `https://merlinus-platform.<account>.workers.dev`.

### Datasets

| Dataset | Paginated | PII | What partners learn |
|---------|-----------|-----|---------------------|
| `manifest` | no | none | Full catalog + auth instructions |
| `platform` | no | none | Version, flags, binding presence (no secrets) |
| `topology` | no | minimal | DealerGroup → Dealer → Dealership graph |
| `staff` | yes | redacted | Roles, MFA flags, email **hashes** only |
| `modules` | yes | none | Per-rooftop module on/off |
| `usage` | yes | none | `story_generated` billing meters |
| `audit` | yes | redacted | Hash-chained audit trail |
| `provision` | yes | none | `dealer.provision` (pilot create events) |
| `ro_metrics` | yes | none | RO/line counts, story flags — no story text |
| `ai_jobs` | yes | none | Job status/progress (no AI result blobs) |
| `billing` | no | none | Estimates / counts per rooftop |
| `selfheal` | no | none | Nightly + morning ops reports |
| `health` | no | none | Live dependency matrix |
| `readiness` | no | none | Pilot readiness checklist |
| `capability` | no | none | Capability matrix snapshot if generated |

---

## Authentication (two ways)

### A) Service token (recommended for GCP team)

1. Generate a long random secret (≥32 hex chars):

```bash
openssl rand -hex 32
```

2. On Cloudflare Worker **merlinus-platform** set:

| Name | Value | Type |
|------|--------|------|
| `PILOT_EXPORT_ENABLED` | `true` | Variable |
| `PILOT_EXPORT_TOKEN` | *(the secret)* | **Secret** |

3. Partners call:

```bash
curl -sS -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  "https://YOUR_HOST/api/export/pilot" | jq .
```

Optional header: `x-pilot-export-token: YOUR_TOKEN_HERE`

**Share the token only via password manager / secret store — never Slack/email plaintext long-term.** Rotate after the migration project.

### B) National owner session (you, in the browser)

1. Log in as national owner.  
2. **Exit any rooftop** (national/group home).  
3. Open **Data export** tab → Load catalog / Preview / Download.  
4. Or call the same URLs with your browser session cookie.

---

## Query parameters

| Param | Used on | Meaning |
|-------|---------|---------|
| `limit` | paginated datasets | 1–500 (default 100) |
| `cursor` | paginated | `meta.nextCursor` from previous page |
| `dealershipId` | most | Filter to one rooftop in your scope |
| `since` | audit, usage, provision, ro_metrics, ai_jobs | ISO date lower bound |
| `until` | same | ISO date upper bound |

### Pagination loop (example)

```bash
TOKEN=...
HOST=https://YOUR_HOST
DS=usage
CURSOR=""

while true; do
  URL="$HOST/api/export/pilot/$DS?limit=200"
  if [ -n "$CURSOR" ]; then URL="$URL&cursor=$CURSOR"; fi
  RESP=$(curl -sS -H "Authorization: Bearer $TOKEN" "$URL")
  echo "$RESP" >> "pilot-$DS.jsonl"
  CURSOR=$(echo "$RESP" | jq -r '.meta.nextCursor // empty')
  [ -z "$CURSOR" ] && break
done
```

---

## Month-long pilot: what to pull and when

| When | Datasets | Why |
|------|----------|-----|
| **Day 0** (after provision) | `topology`, `staff`, `modules`, `provision`, `readiness`, `platform` | Staging / two-rooftop setup snapshot |
| **Daily** | `usage`, `health`, `selfheal` | Throughput + reliability for GCP sizing |
| **Weekly** | `audit`, `ro_metrics`, `ai_jobs`, `billing` | Behavior + cost model |
| **End of month** | Full set + `capability` | Migration freeze pack |

### GCP team — extra artifacts they will love

1. **This API’s JSON** (above)  
2. **`docs/generated/CAPABILITY-MATRIX.md`** (route → module map)  
3. **`docs/Multi-Tenant-Isolation.md`** (app-layer D1 tenancy honesty)  
4. **`docs/SECOND-FACILITY-PILOT.md`** (same-owner two stores)  
5. **Wrangler bindings** list: `DB`, `KV_STORE`, `APEX_R2`, `AI_JOBS_QUEUE`  
6. **Env inventory** (names only — not values): see `.env.example`  
7. **Sentry** project (if configured) for stack traces  
8. **Cloudflare Workers analytics** (requests, CPU, errors) from the dashboard  

Encrypted PII (RO numbers, stories, VIN) should move via a **key re-encryption runbook**, not this API.

---

## Response shape

```json
{
  "ok": true,
  "meta": {
    "schemaVersion": "1.0.0",
    "dataset": "usage",
    "generatedAt": "2026-08-01T12:00:00.000Z",
    "authMode": "service_token",
    "limit": 100,
    "nextCursor": "…or null",
    "hasMore": true,
    "dealershipIds": ["clxyz…"],
    "notes": ["pii=none", "…"]
  },
  "data": [ /* rows */ ],
  "payload": { /* optional non-list blob for platform/health/billing */ }
}
```

Headers: `X-Pilot-Export-Schema`, optional `X-Pilot-Export-Next-Cursor`.

Every successful export writes audit action **`pilot.export`** (who/what/when).

---

## Security guarantees

| Never exported | Why |
|----------------|-----|
| Passwords / password hashes | Credential theft |
| MFA secrets / backup codes | Account takeover |
| Session / refresh tokens | Session hijack |
| Env secrets (`GROK_*`, `SESSION_SECRET`, …) | Platform compromise |
| Warranty story text / technician notes | PII + OEM sensitivity |
| Customer name, phone, VIN, RO number plaintext | Privacy |
| AI job `resultEncrypted` blobs | Contains story/PII |

Emails appear only as **SHA-256 hashes** + domain (e.g. `dealer.com`).

---

## Owner UI

National console → **Data export** tab → Load catalog / Preview / Download JSON.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EXPORT_DISABLED` | Set `PILOT_EXPORT_ENABLED=true` |
| `UNAUTHORIZED` / invalid token | Check Bearer matches Worker secret (no spaces) |
| `DEALERSHIP_CONTEXT_REQUIRED` | Owner must exit rooftop first |
| Empty `data` | No rooftops in scope yet — provision pilots |
| 429 | Rate limited — slow down (≈20–30 req/min) |

---

## For the Google Cloud build team (checklist)

- [ ] Read this doc + Multi-Tenant-Isolation  
- [ ] Map `topology` to your multi-tenant schema (group / dealer / rooftop)  
- [ ] Use `usage` + `billing` for cost models  
- [ ] Use `audit` + `provision` for compliance parity  
- [ ] Use `health` / `selfheal` for SLOs and night jobs  
- [ ] Use `staff` only for role design — re-invite users on GCP (do not import password hashes)  
- [ ] Plan separate ciphertext migration for encrypted RO/story fields  
- [ ] Pin `schemaVersion` in your importers  

---

## Related

- [SECOND-FACILITY-PILOT.md](./SECOND-FACILITY-PILOT.md)  
- [PILOT-SAFETY-AUDIT-2026-08-01.md](./PILOT-SAFETY-AUDIT-2026-08-01.md)  
- [Self-Heal-and-Nightly-Maintenance.md](./Self-Heal-and-Nightly-Maintenance.md)  
- [Multi-Tenant-Isolation.md](./Multi-Tenant-Isolation.md)  
