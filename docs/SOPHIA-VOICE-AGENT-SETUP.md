# Sophia — Mercedes-Benz Dealers Receptionist Voice Agent

**Agent:** Sophia  
**Staging dealership:** Mercedes-Benz Staging  
**Staging DID:** `+1 (401) 645-4563` → E.164 `+14016454563`  
**Architecture:** Twilio Voice webhooks → Apex Worker → Grok tools + multi-turn memory → TwiML speech

Sophia is the flagship multi-tenant voice receptionist: warm luxury tone, dynamic `[DEALERSHIP_CONTEXT]`, specialist routing, staff work tickets, rich call logs, and optional xAI Realtime WebSocket for advanced media paths.

---

## 1. What was built

| Area | Location |
|---|---|
| Dealership context + staging profile | `src/lib/voiceAgent/dealershipContext.ts` |
| Full Sophia system prompts | `src/lib/voiceAgent/sophiaPrompt.ts` |
| Multi-turn runtime + logging | `src/lib/voiceAgent/runtime.ts` |
| Tools (info, sentiment, summary, human transfer) | `src/lib/voiceAgent/tools.ts` |
| Twilio TwiML (neural voice, silence recovery, dial) | `src/lib/voiceAgent/twilio.ts` |
| Inbound webhook | `src/app/api/voice/inbound/route.ts` |
| Gather / turn webhook | `src/app/api/voice/gather/route.ts` |
| Status callback | `src/app/api/voice/status/route.ts` |
| Realtime WebSocket factory | `src/lib/voiceAgent/realtimeSophia.ts` |
| Seed staging line | `scripts/seed-voice-staging-line.mjs` |

### Welcome message (example)

> Thank you for calling **Mercedes-Benz Staging**. This is **Sophia**, your virtual receptionist. How may I help you today — service, parts, sales, or something else?

### System prompt

Uses dynamic substitution of dealership facts via:

```text
[DEALERSHIP_CONTEXT]
…formatted hours, address, phone, policies…
```

New rooftops: pass `voiceContext` inside `DealershipModule.configJson` for `voice_agent`, or map a DID in `resolveDealershipContext`.

---

## 2. Required secrets / env (Worker)

| Variable | Purpose |
|---|---|
| `GROK_API_KEY` | xAI key for Sophia turns (must be valid) |
| `TWILIO_ACCOUNT_SID` | Twilio account |
| `TWILIO_AUTH_TOKEN` | Signature validation + API |
| `NEXT_PUBLIC_APP_URL` or `VOICE_PUBLIC_BASE_URL` | **Public HTTPS base** Twilio can reach (no localhost) |
| Optional `GROK_VOICE_MODEL` | Override chat model for voice |
| Optional `VOICE_TWILIO_SAY_VOICE` | Default `Polly.Joanna-Neural` |
| Optional `VOICE_TWILIO_SKIP_SIGNATURE=true` | **Local tunnel only** — never production |

Also ensure:

- Product module **`voice_agent`** is enabled for the staging dealership.
- D1 encryption keys already configured for the platform.

```bash
npx wrangler secret put GROK_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
# Prefer setting the public base as a secret or var so Twilio signatures match:
npx wrangler secret put NEXT_PUBLIC_APP_URL
# value example: https://clarityautoapex.com
```

---

## 3. Connect Twilio number +1 (401) 645-4563

### A. Register the DID on the staging rooftop

1. Sign in as owner/manager on **Mercedes-Benz Staging** (seed dealership with voice_agent on).
2. Open Voice ops / lines UI, **or** run the seed script (see below).
3. Create line: `+14016454563`, label e.g. `Sophia Staging`.

Seed script (remote D1):

```bash
node scripts/seed-voice-staging-line.mjs
```

This upserts `VoiceAgentLine` for `+14016454563` on `seed-dealership` and enables `voice_agent` if missing.

### B. Twilio Console → Phone Numbers → +1 401 645 4563

**A call comes in**

| Field | Value |
|---|---|
| Configure with | Webhook |
| A call comes in | `https://YOUR_PRODUCTION_HOST/api/voice/inbound` |
| HTTP | **HTTP POST** |

**Call status changes** (optional but recommended)

| Field | Value |
|---|---|
| Status callback URL | `https://YOUR_PRODUCTION_HOST/api/voice/status` |
| HTTP | POST |

Replace `YOUR_PRODUCTION_HOST` with the same host as `NEXT_PUBLIC_APP_URL` / `VOICE_PUBLIC_BASE_URL` (e.g. `clarityautoapex.com` or `merlinus-platform.hombre3536.workers.dev`).

**Important:** Twilio signs the exact URL. If you set the webhook to the custom domain, `absoluteVoiceUrl` must resolve to that same domain.

### C. Enable voice_agent module

Manager **Modules** → enable **AI Voice Agent** for the rooftop, or rely on the seed script.

---

## 4. Call flow (production)

```
Caller → Twilio DID
      → POST /api/voice/inbound  (signature check, line lookup, create VoiceCall)
      → TwiML: Sophia welcome + <Gather speech>
      → POST /api/voice/gather?callId=…
      → Grok + tools (multi-turn memory, tickets, sentiment, summary)
      → TwiML reply or warm <Dial> or hangup
      → Segments + encrypted transcript + metricsJson on VoiceCall
```

### Logged fields

- Transcript segments (encrypted)
- Routing path (receptionist → specialists)
- Metrics: handoffs, work items, containment, **sentiment**, **callSummary**, **primaryIntent**, agent name
- Outcome: `resolved_by_agent` | `staff_followup` | `transferred_human` | …
- Optional recording (existing recording webhook)

View in **Voice ops dashboard** / `GET /api/voice/calls` (manager).

---

## 5. Realtime WebSocket (advanced / sidecar)

Production Workers use Gather + chat completions (reliable on CF).  
For bidirectional audio experiments:

```js
// Node 22+ or: npm install ws
import { createReceptionistAgent, STAGING_MERCEDES_BENZ_CONTEXT } from './dist-or-bundled';

const session = createReceptionistAgent(STAGING_MERCEDES_BENZ_CONTEXT, {
  onOpen: () => console.log('Sophia realtime connected'),
  onSpeech: (t) => console.log('Sophia:', t),
  onError: (e) => console.error(e),
});

session.sendUserText('What are your service hours?');
```

Module: `src/lib/voiceAgent/realtimeSophia.ts`  
Requires valid `GROK_API_KEY` and network access to `wss://api.x.ai/v1/realtime` (confirm model availability with xAI).

---

## 6. Onboarding a new dealer

1. Create/select dealership, enable `voice_agent`.
2. Buy/assign a Twilio DID.
3. `POST /api/voice/lines` with `{ "e164Number": "+1…", "label": "Main" }`.
4. Point Twilio Voice URL to `/api/voice/inbound`.
5. Optional: store richer hours/address in module `configJson`:

```json
{
  "voiceContext": {
    "dealershipName": "Your MB Dealership",
    "mainPhoneE164": "+1…",
    "hours": [{ "label": "Service", "hours": "Monday through Friday seven thirty to six" }],
    "addressLine1": "…",
    "agentDisplayName": "Sophia",
    "humanTransferEnabled": true,
    "humanTransferNumberE164": "+1…"
  }
}
```

Staging number `+14016454563` is pre-mapped to the Mercedes-Benz Staging profile.

---

## 7. Smoke test checklist

- [ ] `GROK_API_KEY` accepted by xAI (not placeholder)
- [ ] Line row exists for `+14016454563`
- [ ] `voice_agent` module enabled
- [ ] Twilio webhook URL matches public host
- [ ] Call → hear Sophia greeting with dealership name
- [ ] Ask hours → correct staging hours
- [ ] Ask for service appointment → name/phone capture + service ticket
- [ ] Manager dashboard shows call, summary/sentiment when tools fire
- [ ] Hangup / status callback marks completed + duration

---

## 8. Support scenarios Sophia handles

Hours · directions · service booking follow-up · parts · sales · loaner check · roadside guidance · warranty escalation · complaint empathy · human transfer (when configured) · multi-agent handoff with brief · end-of-call summary logging.
