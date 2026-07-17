# Merlin — Go-Live Checklist (Final Go / No-Go)

**Audience:** Service Manager, Dealership IT, Fixed Ops Director  
**When to use:** **24–48 hours before go-live** — final review before launch  
**Version:** 3.0.1

---

This is the **last gate** before technicians use Merlin on live repair orders. Every critical item must be **PASS** or have a documented exception approved by the Fixed Ops Director.

**Related documents:** [Rollout Checklist](./Rollout-Checklist.md) (full rollout) · [Admin Setup Guide](./Admin-Setup-Guide.md) · [Go-Live Summary](./Go-Live-Summary.md) · [Support Playbook](./Support-Playbook.md) · [Go-Live Email Template](./Go-Live-Email-Template.md)

---

## Dealership information

| Field | Value |
|-------|-------|
| **Dealership name** | [DEALERSHIP NAME] |
| **Go-live date** | [GO-LIVE DATE] |
| **Merlin URL** | [MERLIN URL] |
| **Merlin version** | [VERSION — from app footer or /api/status] |
| **Review date** | [DATE OF THIS REVIEW] |
| **Review lead** | [NAME, ROLE] |

---

## Section A — Technical verification (IT)

*All items must pass unless noted as warning with FO approval.*

### Environment & deployment

- [ ] **PASS** — `npm run validate:pre-rollout` completed with **0 critical failures** (review report saved)
- [ ] **PASS** — `MERLIN_BASE_URL=[MERLIN URL] npm run validate:pre-rollout` live health check passed
- [ ] **PASS** — `GET /api/health` returns `"status": "ok"` or approved `"degraded"` with written rationale
- [ ] **PASS** — `GET /api/status` shows `maintenance: false`
- [ ] **PASS** — `MERLIN_MAINTENANCE_MODE` is **off** in production
- [ ] **PASS** — App footer on tablet shows correct version, commit, and build date
- [ ] **PASS** — Database migrations applied — no pending errors in deploy logs
- [ ] **PASS** — `GROK_API_KEY` configured; no `NEXT_PUBLIC_*` AI keys in environment
- [ ] **PASS** — Audit log hash-chain integrity shows **VALID**
- [ ] **WARN OK** — KV rate limiting configured (warn acceptable if documented)

### Shop-floor technology

- [ ] **PASS** — All bay tablets assigned and labeled
- [ ] **PASS** — Tablets run Chrome or Edge (latest stable)
- [ ] **PASS** — Merlin URL bookmarked or kiosk shortcut on every tablet
- [ ] **PASS** — Wi‑Fi signal verified at each bay (no dead zones)
- [ ] **PASS** — Microphone permission tested on ≥ 2 bay tablets
- [ ] **PASS** — Voice input works: tap-to-toggle **and** push-to-talk on ≥ 1 tablet
- [ ] **PASS** — End-to-end smoke test: notes → generate story → copy → PDF (on tablet)

### Security & compliance

- [ ] **PASS** — Seed / default passwords rotated
- [ ] **PASS** — xAI Data Processing Agreement on file
- [ ] **PASS** — Encryption key (`ENCRYPTION_KEY`) stored in secure vault — not in email or chat
- [ ] **PASS** — No CSP or auth errors in browser console on login + line view

**IT sign-off**

| Name | Date | Go / No-Go |
|------|------|------------|
| [IT LEAD] | | ☐ Go ☐ No-Go |

---

## Section B — Communication plan (Service Manager)

- [ ] **PASS** — Go-live announcement email sent per [Go-Live Email Template](./Go-Live-Email-Template.md)
- [ ] **PASS** — Go-live date confirmed with Fixed Ops Director and General Manager
- [ ] **PASS** — Warranty administrator briefed on CDK paste and PDF workflow
- [ ] **PASS** — Support contacts posted in service lounge and at bay stations:

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Service Manager | [NAME] | [PHONE] | [EMAIL] |
| IT | [NAME] | [PHONE] | [EMAIL] |
| Trainer / floor support | [NAME] | [PHONE] | [EMAIL] |
| Warranty admin | [NAME] | [PHONE] | [EMAIL] |

- [ ] **PASS** — [Technician Quick Start](./Technician-Quick-Start.md) printed or linked on every tablet
- [ ] **PASS** — Morning-of reminder email scheduled for [GO-LIVE DATE]
- [ ] **PASS** — Technicians know: Merlin does not invent test results — they own accuracy
- [ ] **PASS** — General Manager received [Go-Live Summary](./Go-Live-Summary.md) (or briefing scheduled)

**Service Manager sign-off**

| Name | Date | Go / No-Go |
|------|------|------------|
| [SERVICE MANAGER] | | ☐ Go ☐ No-Go |

---

## Section C — Training completion (Trainer / Service Manager)

- [ ] **PASS** — Training session completed per [Training Outline](./Training-Outline.md) **OR** make-up scheduled before go-live
- [ ] **PASS** — Attendance roster filed — [%] of active warranty technicians trained: [___]%
- [ ] **PASS** — Every trained technician demonstrated: voice input, generate story, edit, copy for CDK
- [ ] **PASS** — Absent technicians have make-up session booked: [DATE/TIME]
- [ ] **PASS** — Trainer / floor support assigned for go-live day: [NAME] until [TIME]
- [ ] **PASS** — Noisy-bay scenario covered (push-to-talk recommended)
- [ ] **PASS** — Manual typing fallback explained to all attendees

**Trainer sign-off**

| Name | Date | Go / No-Go |
|------|------|------------|
| [TRAINER] | | ☐ Go ☐ No-Go |

---

## Section D — Business readiness (Fixed Ops Director)

- [ ] **PASS** — Go-live aligns with group rollout calendar (if applicable)
- [ ] **PASS** — First-week adoption target set (e.g. ≥ 80% of warranty lines use Merlin by day 5)
- [ ] **PASS** — Service manager committed to review first 3 live stories on go-live day
- [ ] **PASS** — Warranty submission process unchanged except story source — admin aligned
- [ ] **PASS** — Rollback plan reviewed and understood (Section E below)
- [ ] **PASS** — Post-go-live review meeting scheduled: [DATE — within 5 business days]

**Fixed Ops sign-off**

| Name | Date | Go / No-Go |
|------|------|------------|
| [FIXED OPS DIRECTOR] | | ☐ Go ☐ No-Go |

---

## Section E — Rollback plan

Use rollback only if Merlin blocks warranty operations or a critical security issue is discovered. **Story content questions are not rollback triggers** — use manual typing and service manager support.

### Rollback triggers (any one = consider rollback)

| Trigger | Severity |
|---------|----------|
| Audit chain integrity failure | **Critical — immediate** |
| Widespread login failure (> 50% of users) | **Critical** |
| Database unreachable for > 30 minutes during shop hours | **Critical** |
| Data exposure or security incident | **Critical — immediate** |
| AI generation down but typing works | **Degraded — maintenance mode, not full rollback** |

### Rollback procedure

| Step | Action | Owner | Target time |
|------|--------|-------|-------------|
| 1 | Service Manager announces: "Pause Merlin AI — continue ROs manually" | SM | Immediate |
| 2 | IT enables `MERLIN_MAINTENANCE_MODE=true` and redeploys | IT | < 15 min |
| 3 | IT verifies `/api/status` shows `maintenance: true` | IT | < 5 min |
| 4 | Technicians document notes by typing; use prior CDK workflow for stories | SM | Ongoing |
| 5 | IT investigates root cause; logs preserved | IT | Same day |
| 6 | FO notified; incident summary within 24 hours | SM + IT | < 24 hr |
| 7 | Fix validated in staging; re-run `validate:pre-rollout` before re-enabling | IT | Before restore |
| 8 | Disable maintenance mode; SM announces all-clear | IT + SM | When validated |

### Manual fallback (no rollback needed)

These issues **do not** require rollback — use [Support Playbook](./Support-Playbook.md):

- Single tablet voice failure → type manually; IT fixes tablet
- Occasional AI timeout → regenerate or type story
- One technician login issue → password reset
- Wi‑Fi blip → type notes; retry generation when connected

**Rollback decision authority:** [FIXED OPS DIRECTOR NAME] + [IT LEAD NAME]

---

## Final go / no-go decision

| Criterion | Status |
|-----------|--------|
| Section A — Technical | ☐ Go ☐ No-Go |
| Section B — Communication | ☐ Go ☐ No-Go |
| Section C — Training | ☐ Go ☐ No-Go |
| Section D — Business readiness | ☐ Go ☐ No-Go |
| Section E — Rollback plan understood | ☐ Go ☐ No-Go |

### Documented exceptions (if any)

| Item | Exception | Approved by | Date |
|------|-----------|-------------|------|
| | | | |

---

## **FINAL DECISION**

| | |
|---|---|
| **Decision** | ☐ **GO** — Proceed with go-live on [GO-LIVE DATE] &nbsp;&nbsp; ☐ **NO-GO** — Postpone to [NEW DATE] |
| **Reason (if No-Go)** | |
| **General Manager** | Name: _______________ Date: _______ Signature: _______ |
| **Fixed Ops Director** | Name: _______________ Date: _______ Signature: _______ |
| **Service Manager** | Name: _______________ Date: _______ Signature: _______ |
| **IT Lead** | Name: _______________ Date: _______ Signature: _______ |

---

## After go — first 48 hours

- [ ] Morning reminder email sent
- [ ] Floor support on site go-live day
- [ ] First 3 live stories reviewed by service manager
- [ ] `/api/health` monitored — no sustained `"error"` status
- [ ] Technician feedback collected (informal or survey)
- [ ] [Rollout Checklist](./Rollout-Checklist.md) Phase 3 started

---

*Merlin — Mercedes-Benz Warranty Story Generator · Go-Live Checklist*