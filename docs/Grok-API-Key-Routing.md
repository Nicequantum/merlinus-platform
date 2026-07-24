# Grok API key routing (multi-key)

**Version:** 4.1.0 · **Updated:** 2026-07-24

Merlinus Apex supports **three** server-only xAI keys for quota isolation.

## Mapping

| Env var (Worker secret) | Slot | Features |
|-------------------------|------|----------|
| **`GROK_API_KEY`** | `default` | Warranty story generate / score / review · customer-pay dynamic narrative · video MPI customer report · Hub conversation insights · health probe (default) · Apex `/api/grok/proxy` upstream |
| **`GROK_API_KEY_1`** | `vision` | **RO scan extract** · **Xentry / diagnostics extract** |
| **`GROK_API_KEY_2`** | `voice` | **Sophia** voice chat tools · realtime WebSocket session |

## Fallbacks (when a purpose secret is missing)

| Slot | Resolution order |
|------|------------------|
| default | `GROK_API_KEY` only |
| vision | `GROK_API_KEY_1` → `GROK_API_KEY` |
| voice | `GROK_API_KEY_2` → `GROK_API_KEY` → `XAI_API_KEY` (legacy) |

Never set `NEXT_PUBLIC_GROK_*` / `NEXT_PUBLIC_XAI_*`.

## Code entry points

| Call site | Slot |
|-----------|------|
| `src/lib/grok.ts` → `extractROFromImages` / `extractDiagnosticsFromImage` | vision |
| `src/lib/grok.ts` → story / score / review / customer-pay / video report | default |
| `src/lib/hub/insightAi.ts` | default |
| `src/lib/voiceAgent/grokClient.ts` | voice |
| `src/lib/voiceAgent/realtimeSophia.ts` | voice |
| `src/app/api/grok/proxy/route.ts` upstream | default |
| `src/lib/healthChecks.ts` | reports all three |

Resolver: `src/lib/grokApiKey.shared.ts` (`resolveGrokApiKey`, `getGrokApiKeyForSlot`).

## Set secrets on Cloudflare

```bash
npx wrangler secret put GROK_API_KEY --name merlinus-platform
npx wrangler secret put GROK_API_KEY_1 --name merlinus-platform
npx wrangler secret put GROK_API_KEY_2 --name merlinus-platform
```

Secret-only updates do **not** require a full Worker redeploy. Code that *reads* multi-key routing **does** require deploy of this change.

## Operator verification

### 1. Secrets present

```bash
npx wrangler secret list --name merlinus-platform
# Expect: GROK_API_KEY, GROK_API_KEY_1, GROK_API_KEY_2
```

### 2. Each key accepted by xAI (local, do not paste keys into chat)

```powershell
# Replace $k with the key value for that slot
$headers = @{ Authorization = "Bearer $k" }
Invoke-WebRequest -Uri 'https://api.x.ai/v1/models' -Headers $headers -UseBasicParsing
# Expect HTTP 200 for each of the three keys
```

### 3. Health (manager, dealership context)

Open **Manager → Control Center → Health** (or authenticated `GET /api/health`):

- `grok` / `grokConfig` detail should list slots, e.g.  
  `GROK_API_KEY=…abcd; GROK_API_KEY_1=…wxyz; GROK_API_KEY_2=…1234`  
- If you see `(fallback)` on vision/voice, that purpose secret is missing and the default key is used.
- Connectivity probe reports `default=ok; vision=ok; voice=ok` when all three are valid.

### 4. Feature smoke

| Feature | How to confirm correct key |
|---------|----------------------------|
| RO Process | Green uploads + extract succeeds without “API key rejected” |
| Xentry photo analysis | Same |
| Generate warranty story | Completes on a line |
| Sophia / voice turn | Call or tool path succeeds |
| Logs | Perf / warn lines may include `keySlot=vision` or `keyEnv=GROK_API_KEY_1` |

### 5. Unit tests

```bash
npx tsx --import ./tests/setup/preload.mjs --test tests/unit/grokApiKey.test.ts
```
