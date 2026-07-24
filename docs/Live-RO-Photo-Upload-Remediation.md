# Live remediation — RO photo red badge / “Service temporarily unavailable”

**Version:** 4.1.0 · **Updated:** 2026-07-23  
**Symptom:** Main RO scan pages show **red** instead of green; toast  
`Service temporarily unavailable. Check your connection and try again.`  
**Blocks:** Process RO → technician repair workflow.

---

## 0. What “red” means (do not chase queue first)

| Layer | Meaning |
|-------|---------|
| Red badge | Client `uploadStatus === 'error'` after `POST /api/upload` failed |
| Generic toast | Response was **not usable JSON** (HTML 5xx, empty 5xx) *or* storage/edge failure mapped poorly |
| Path | `api.uploadImage` → `/api/upload` → **R2 `APEX_R2`** (not AI queue) |

AI queue consumer / DLQ is **out of scope** for the red badge. Fix storage + upload first.

---

## 1. Immediate ops (no Network capture required) — do in order

### 1.1 Confirm R2 binding on **live** main Worker

Cloudflare Dashboard → Workers → **`merlinus-platform`** → Settings → Bindings:

- Binding name: **`APEX_R2`**
- Bucket: **`apex`** (lowercase)

CLI:

```bash
npx wrangler r2 bucket list
# Expect: apex

# After any binding change, redeploy main app:
npm run build
npx wrangler deploy
```

### 1.2 Manager Control Center → Health

Signed-in **manager with dealership context**:

- Open `/manager/center` → **Health**
- **`objectStorage` / storage** must be **ok** (not error)
- If error: binding not live — fix 1.1 and redeploy

### 1.3 Warm the bay, then single-photo test

1. Open app on tablet → hard refresh  
2. Log in as technician (dealership context)  
3. Open RO scan → add **one** photo  
4. Expect **green** check within a few seconds  

If still red: continue with Network tab (section 3).

### 1.4 Optional — tail Worker while uploading

```bash
npx wrangler tail merlinus-platform
```

Look for `APEX_R2`, `upload`, `Object storage put failed`, unhandled exceptions.

---

## 2. Code hardening shipped in this remediation

| Change | Purpose |
|--------|---------|
| `src/lib/storage/r2.ts` | OpenNext resolution parity with D1 (ALS → package context → workers env) |
| `src/app/api/upload/route.ts` | Early JSON 503 if R2 missing; FormData errors as JSON; never fall through to HTML |
| `src/lib/apiResponseParse.ts` | Non-JSON toast includes **HTTP status** for ops |
| `src/lib/api.ts` `apiUpload` | **No FormData retry** on same body (avoids empty second attempt); outer helper retries fresh files |
| `src/utils/uploadHelpers.ts` | Retry 500 as well as 502/503 for cold-start |

Deploy these with main Worker after ops binding check.

---

## 3. If still failing — Network capture (1 minute)

DevTools → Network → fail one upload → **`POST /api/upload`**:

| Observation | Action |
|-------------|--------|
| **503** JSON “Photo storage is not configured” | R2 binding (1.1) |
| **HTML** / empty 5xx | Worker crash — `wrangler tail` + redeploy latest build |
| **403** CSRF | Hard refresh + re-login |
| **403** dealership context | Enter dealership (owners) |
| **401** | Re-login |
| **No request** | Offline / wrong origin / service worker |

---

## 4. After green badges — Process RO / extract

Once thumbs are green:

1. Run **Process RO** / extract  
2. Failures now point at **Grok** (`GROK_API_KEY`) or **image fetch from R2**, not upload  
3. Health: `grok` / `grokConfig` ok  
4. Queue critical is separate (story async jobs)

---

## 5. Verification checklist (sign off)

| # | Check | Pass |
|---|-------|------|
| V1 | Health **objectStorage** = ok | ☐ |
| V2 | Single photo → **green** badge | ☐ |
| V3 | 3–6 page RO scan → all green | ☐ |
| V4 | Process RO / extract succeeds (or clear Grok error JSON) | ☐ |
| V5 | Xentry photo upload green (same storage path) | ☐ |
| V6 | Second device / stable Wi‑Fi same result | ☐ |

---

## 6. Do **not** prioritize for this blocker

- AI queue consumer secrets (unrelated to red upload badge)  
- Twilio Voice  
- Companion LWW process  

Complete those after V1–V4 are green.
