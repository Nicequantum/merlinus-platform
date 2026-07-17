# Merlin — Support Playbook

**Audience:** Dealership IT, Service Managers, internal support team  
**Purpose:** Fast troubleshooting and escalation for shop-floor issues  
**Version:** 3.0.1

---

Keep this document printed in the service manager office and shared with IT. Technicians should contact the **Service Manager** first for how-to questions and **IT** for system outages.

**Related documents:** [Technician Quick Start](./Technician-Quick-Start.md) · [Admin Setup Guide](./Admin-Setup-Guide.md) · [Go-Live Checklist](./Go-Live-Checklist.md)

---

## Dealership support contacts

| Role | Name | Phone | Email | Hours |
|------|------|-------|-------|-------|
| Service Manager (Tier 1 — usage) | [SM NAME] | [PHONE] | [EMAIL] | [HOURS] |
| Lead Technician / Trainer | [TR NAME] | [PHONE] | [EMAIL] | [HOURS] |
| Dealership IT (Tier 2 — system) | [IT NAME] | [PHONE] | [EMAIL] | [HOURS] |
| Fixed Ops Director (Tier 3 — escalation) | [FO NAME] | [PHONE] | [EMAIL] | [HOURS] |
| Platform / vendor escalation | [VENDOR CONTACT] | [PHONE] | [EMAIL] | Business hours |

**Merlin URL:** [MERLIN URL]

---

## Response time targets

| Priority | Definition | First response | Resolution target |
|----------|------------|----------------|-------------------|
| **P1 — Critical** | Audit integrity error, total outage, suspected data breach | 15 minutes | 2 hours |
| **P2 — High** | AI down for all users, widespread login failure | 30 minutes | 4 hours |
| **P3 — Medium** | Single tablet voice/login issue, intermittent timeouts | 2 hours | Same business day |
| **P4 — Low** | How-to, template question, story editing help | 4 hours | 1 business day |

**Rule:** Never hold up a customer repair for Merlin support. Technicians type notes and continue the job.

---

## Triage flowchart

```
Technician reports issue
        │
        ▼
Is a customer RO blocked right now?
   │              │
  Yes             No
   │              │
   ▼              ▼
Type manually   Story / how-to question?
Continue job         │           │
                 Yes           No
                  │             │
                  ▼             ▼
            Service Mgr      System / login /
            (Tier 1)         voice / outage?
                                  │
                          ┌───────┴───────┐
                         Yes              No
                          │                │
                          ▼                ▼
                    Dealership IT      Service Mgr
                    (Tier 2)           coaches user
                          │
                    Still broken?
                          │
                          ▼
                  Fixed Ops + vendor
                    (Tier 3)
```

---

## Common issues — technicians

### 1. Voice input not working

| Symptom | Likely cause | Support steps |
|---------|--------------|---------------|
| Mic button missing | Voice disabled in config | Confirm `voiceEnabled` in `/api/status`; redeploy if needed |
| "Microphone blocked" | Browser permission denied | Tablet Settings → Site permissions → Microphone → Allow → reload |
| Mic does nothing | Wrong browser | Use **Chrome or Edge** — not Safari/Firefox on tablet |
| Words cut off mid-sentence | Bay noise or timeout | Switch to **push-to-talk**; hold mic closer; tap **Retry** |
| Listening stops after ~15 sec | Silence timeout (normal) | Tap **Retry**; dictate in shorter phrases |
| Wrong words appear | Speech recognition error | **Not an outage** — technician edits text |
| "Voice unavailable" | Unsupported browser | Install Chrome/Edge; or type manually |

**Technician fix (30 seconds):** Push-to-talk → hold mic → speak → release. If still broken → **type manually** → notify SM.

**IT fix:** Verify mic permission at OS level (MDM policy); test on second tablet to isolate device vs network.

---

### 2. AI story generation fails

| Symptom | Likely cause | Support steps |
|---------|--------------|---------------|
| "Generating with Grok…" spins then errors | Timeout or API issue | Check `/api/health` → `services.grok`; verify `GROK_API_KEY` |
| 503 / maintenance message | Maintenance mode on | Check `/api/status` → `maintenance: true`; disable when ready |
| Story quality poor | Thin technician notes | **Not IT** — SM coaches: document tests before generating |
| Rate limit message | Too many requests | Wait 1 minute; check for shared IP abuse; review KV config |

**Technician fix:** Shorten notes → tap **Regenerate**. If down → type story manually in warranty story field.

**IT fix:**

```bash
curl -s [MERLIN URL]/api/health | jq '.status, .services'
```

If `grok` is not `"ok"` → verify API key in Vercel env → redeploy.

---

### 3. Login and session issues

| Symptom | Likely cause | Support steps |
|---------|--------------|---------------|
| "Invalid credentials" | Wrong password | SM resets password in Merlin Settings |
| Frequent logouts | Device clock drift / cache | Sync tablet clock; clear site data; re-login |
| Blank page after login | Network or deploy issue | Check `/api/health`; verify URL correct |
| Account deactivated | HR / admin action | SM reactivates in Settings |

---

### 4. PDF or CDK copy fails

| Symptom | Likely cause | Support steps |
|---------|--------------|---------------|
| "No warranty story to export" | Empty story field | Generate or type story first |
| Copy toast fails | Browser clipboard restriction | Manual select-all + copy from story field |
| PDF download fails | Browser pop-up block | Allow downloads for Merlin URL |

**Not a system outage** — SM assists with workaround; technician can paste from story field directly.

---

### 5. Wi‑Fi / offline

| Symptom | Likely cause | Support steps |
|---------|--------------|---------------|
| Offline banner appears | Bay Wi‑Fi drop | Type notes offline; retry AI when connected |
| Slow generation | Weak signal | Move tablet closer to AP; IT checks bay coverage |

---

### 6. Audit or security warnings

| Symptom | Action |
|---------|--------|
| Red audit / integrity warning on screen | **P1** — Technician stops using Merlin immediately |
| Suspected wrong customer data shown | **P1** — Stop use; SM + IT investigate |

**IT immediate steps:**

1. Enable `MERLIN_MAINTENANCE_MODE=true`
2. Preserve logs; do not delete database rows
3. Notify Fixed Ops Director
4. Follow [Go-Live Checklist](./Go-Live-Checklist.md) rollback procedure

---

## Common issues — IT quick fixes

| Issue | Command / action |
|-------|------------------|
| Health check | `curl -s [MERLIN URL]/api/health` |
| Lightweight status | `curl -s [MERLIN URL]/api/status` |
| Pause AI (keep login) | Set `MERLIN_MAINTENANCE_MODE=true` → redeploy |
| Resume normal operation | Set `MERLIN_MAINTENANCE_MODE=false` → redeploy |
| Full validation | `MERLIN_BASE_URL=[URL] npm run validate:pre-rollout` |
| Database connectivity | Check `services.database` in health response |

See [Admin Setup Guide](./Admin-Setup-Guide.md) for environment variables and monitoring details.

---

## Escalation path

| Tier | Who | When to escalate | Actions |
|------|-----|------------------|---------|
| **Tier 1** | Service Manager | How-to, story quality, process | Coach technician; refer to [Quick Start](./Technician-Quick-Start.md) |
| **Tier 2** | Dealership IT | Login outage, health `error`, voice on all tablets, AI down for everyone | Run health checks; maintenance mode; redeploy |
| **Tier 3** | Fixed Ops Director | P1 unresolved > 2 hr, rollback decision, multi-store pattern | Authorize rollback; notify GM |
| **Tier 4** | Platform / vendor | Database corruption, audit chain failure, code defect | Open ticket with version + build commit from footer |

### Information to collect before escalating to IT

- Technician name and bay number
- Tablet model and browser (Chrome/Edge version)
- Screenshot or photo of error message
- Time issue started
- Does it affect one tablet or all tablets?
- Merlin version from app footer

### Information to collect before escalating to vendor (Tier 4)

- Dealership name: [DEALERSHIP NAME]
- Merlin URL and version / build commit
- Output of `/api/health` (redact secrets)
- Steps to reproduce
- Number of users affected
- Maintenance mode status

---

## Maintenance mode quick reference

**When to use:** Database work, security investigation, widespread AI failure.

| Step | Action |
|------|--------|
| Enable | `MERLIN_MAINTENANCE_MODE=true` in Vercel → redeploy |
| Verify | `/api/status` → `"maintenance": true` |
| Technician impact | Banner shown; AI paused; **typing still works** |
| Disable | `MERLIN_MAINTENANCE_MODE=false` → redeploy → verify health |

---

## Daily support rhythm (first 2 weeks post go-live)

| When | Action | Owner |
|------|--------|-------|
| Open of business | Check `/api/health` | IT |
| Midday | Walk the floor — voice working? | SM or trainer |
| Close of business | Note issues in support log | SM |
| Weekly | 15-min IT + SM sync | IT + SM |

### Support log template

| Date | Reporter | Bay | Issue | Tier | Resolved? | Notes |
|------|----------|-----|-------|------|-----------|-------|
| | | | | | | |

---

## What support should NOT do

- Do not ask technicians to share passwords in email or text
- Do not disable audit logging to "fix" errors
- Do not put API keys or `ENCRYPTION_KEY` in chat tickets
- Do not delay customer repairs — manual typing is always valid
- Do not edit warranty stories for technicians without their review (liability)

---

## Printable quick reference card

**Preferred:** Use the full double-sided [Bay Reference Card](./Bay-Reference-Card.md) (front + back, laminated).

**Cut along dashed line — post at each bay tablet** *(minimal fallback)*

```
─────────────────────────────────────────
  MERLIN SUPPORT — [DEALERSHIP NAME]
─────────────────────────────────────────
  URL: [MERLIN URL]

  VOICE NOT WORKING?
  → Push-to-talk (hold mic) in loud bays
  → Allow microphone in browser settings
  → Or TYPE your notes — always works

  STORY / HOW-TO          [SM PHONE]
  LOGIN / TABLET / WIFI   [IT PHONE]

  DO NOT WAIT — TYPE & FIX THE CAR FIRST
─────────────────────────────────────────
```

---

*Merlin — Mercedes-Benz Warranty Story Generator · Support Playbook*