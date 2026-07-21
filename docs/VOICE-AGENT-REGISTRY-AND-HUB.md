# Voice Agent Registry & Unified Hub Integration

This document describes how **Sophia** and future department voice agents connect to the **Unified Calendar & Conversation Hub** — the central nervous system for dealership phone + appointments.

---

## Architecture overview

```
                    ┌─────────────────────────────┐
  Twilio DID ──────►│ /api/voice/inbound          │
                    │ resolve DID → dealership    │
                    │ agent = Registry default    │
                    │   or DID map / keywords     │
                    └─────────────┬───────────────┘
                                  │ TwiML Gather
                                  ▼
                    ┌─────────────────────────────┐
  Speech turns ────►│ /api/voice/gather           │
                    │ processAgentTurn (Grok)     │
                    │ tools · multi-agent path    │
                    └─────────────┬───────────────┘
                                  │ on end_call / status completed
                                  ▼
                    ┌─────────────────────────────┐
                    │ hub/callIngest.ts           │
                    │ • AI insight (summary,      │
                    │   key points, sentiment,    │
                    │   intent, suggestion)       │
                    │ • tags (dept/agent/outcome) │
                    │ • HubAuditEvent             │
                    │ • ConversationInsight row   │
                    └─────────────┬───────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
  Manager UI ──────►│ Calendar & Conversation Hub │
                    │ timeline · analytics ·      │
                    │ one-click appointment ·     │
                    │ recording replay · portal   │
                    └─────────────────────────────┘
```

---

## Immediate integration (Sophia → Hub)

| Behavior | Implementation |
|---|---|
| Every completed call on timeline | `buildHubTimeline` merges `VoiceCall` + `ServiceAppointment` |
| Auto AI insights | `ingestCompletedCallToHub` on end_call + Twilio status `completed` |
| Customer / vehicle linking | Slots from tools (`customerName`, `phone`, `vehicleLabel`, `vin`) promoted into insight + timeline |
| Suggested appointment | Insight JSON + **Create appointment** one-click API |
| Tags / categorization | `categorizeCall()` in agent registry |
| Outcomes | `resolved_by_agent` \| `staff_followup` \| `transferred_human` \| … |
| Analytics | `GET /api/hub/analytics` — volume, conversion, avg duration, peak hours |
| Recording replay | `GET /api/voice/calls/[id]/recording/media` from timeline |
| National view | Existing `GET /api/hub/national` for owners |

### Lifecycle hooks

1. **`processAgentTurn`** — when the agent ends the call, awaits hub ingest (so Workers finish AI work).
2. **`markCallCompleted`** (Twilio status) — ingest if status is `completed` and insight not already stored (`skipIfExists`).

---

## Extensible Voice Agent Registry

**File:** `src/lib/voiceAgent/registry.ts`

### Built-in agents

| id | Display | Department |
|---|---|---|
| `receptionist` | Sophia | reception (default inbound) |
| `service` | Service Specialist | service |
| `parts` | Parts Specialist | parts |
| `sales` | Sales Specialist | sales |
| `loaner` | Loaner Specialist | loaner |
| `finance` | Finance Specialist | finance (scaffold) |

### Add a new department agent (checklist)

1. **Register** in `registry.ts` via `define({...})` or `registerVoiceAgent()` at boot:

```ts
registerVoiceAgent({
  id: 'body_shop',
  displayName: 'Body Shop Specialist',
  department: 'other',
  description: 'Collision / body shop intake',
  routeKeywords: ['body shop', 'collision', 'accident', 'dent'],
  buildSystemPrompt: (ctx) => `You are the body shop phone specialist for ${ctx.dealershipName}...`,
  allowedTools: ['update_caller_info', 'create_service_request', 'log_call_summary', 'end_call'],
});
```

2. **Optional DID map** in `DealershipModule.configJson` for `voice_agent`:

```json
{
  "voiceRouting": {
    "defaultAgentId": "receptionist",
    "didMap": {
      "+14015550100": "service",
      "+14015550101": "parts"
    }
  }
}
```

3. **Keywords** — receptionist / routing uses `guessAgentFromUtterance` + existing `route_to_*` tools.

4. **Prompts** — prefer extending `sophiaPrompt.ts` / `buildSophiaSystemPrompt` packs, or fully custom `buildSystemPrompt`.

5. **No hub changes required** — ingest, timeline, tags (`dept:*`, `agent:*`), and analytics pick up new agent ids automatically.

---

## Key APIs

| Method | Path | Role |
|---|---|---|
| GET | `/api/hub/timeline` | Unified feed |
| GET | `/api/hub/analytics` | Voice conversion analytics |
| POST | `/api/hub/conversations/[callId]/summarize` | Manual / refresh AI |
| POST | `/api/hub/conversations/[callId]/create-appointment` | One-click book from call |
| GET | `/api/voice/calls/[id]/recording/media` | Authenticated audio stream |
| GET | `/api/hub/national` | Owner multi-rooftop rollup |

---

## Reliability notes

- Ingest is **idempotent** (upsert by `voiceCallId`).
- Ingest failures **never break** Twilio TwiML (try/catch + safe wrapper).
- Grok insight has **deterministic fallback** from metrics/slots if the model fails.
- Hub mutations write **HubAuditEvent** for compliance.
- Multi-tenant isolation via **RLS** on appointments, insights, voice tables.

---

## Related docs

- `docs/SOPHIA-VOICE-AGENT-SETUP.md` — Twilio DID + secrets for Sophia staging
- Customer appointment portal: `/portal/{token}`
