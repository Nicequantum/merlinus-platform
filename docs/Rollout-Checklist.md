# Merlin — Dealership Rollout Checklist

**Audience:** Service Managers, Fixed Ops Directors, Dealership IT, Trainers  
**Purpose:** End-to-end checklist for multi-dealership Fixed Ops rollout  
**Version:** 3.0.1

---

Use this checklist for **each dealership location**. Copy the checkboxes into your project tracker or print for sign-off meetings.

**Sign-off roles:**

| Role | Abbreviation |
|------|--------------|
| Dealership IT | **IT** |
| Service Manager | **SM** |
| Fixed Ops Director | **FO** |
| Lead Technician / Trainer | **TR** |

---

## Phase 1 — Pre-Rollout Preparation

*Complete 1–2 weeks before go-live.*

### Infrastructure & security

- [ ] **IT** — PostgreSQL provisioned with SSL (`sslmode=require` for remote hosts)
- [ ] **IT** — `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY` generated and stored in secure vault
- [ ] **IT** — `GROK_API_KEY` obtained; xAI Data Processing Agreement executed and filed (**FO**)
- [ ] **IT** — `BLOB_READ_WRITE_TOKEN` set for diagnostic image uploads
- [ ] **IT** — `KV_REST_API_URL` + `KV_REST_API_TOKEN` set for production rate limiting
- [ ] **IT** — `NEXT_PUBLIC_APP_URL` set to production dealership URL
- [ ] **IT** — Vercel project connected; `main` branch deploys successfully
- [ ] **IT** — `npm run db:migrate:deploy` completed without errors
- [ ] **IT** — `npm run db:reencrypt` run if upgrading existing data
- [ ] **IT** — `npm run validate:env` passes
- [ ] **IT** — `npm run validate:pre-rollout` passes (0 critical failures)
- [ ] **IT** — `MERLIN_BASE_URL=https://… npm run validate:pre-rollout` passes against deployed URL
- [ ] **IT** — `GET /api/health` returns `"status": "ok"` or documented acceptable `"degraded"`
- [ ] **IT** — `GET /api/status` shows `maintenance: false`, correct `version`
- [ ] **IT** — CSP / security headers verified — no console violations on login and line view
- [ ] **SM** — Seed / default passwords rotated via Merlin Settings
- [ ] **FO** — Audit log hash-chain integrity verified **VALID**

### Shop-floor hardware & network

- [ ] **IT** — Shop-floor tablets assigned (minimum: 1 per active warranty bay)
- [ ] **IT** — Tablets run **Chrome or Edge** (latest stable)
- [ ] **IT** — Tablets enrolled in MDM (if applicable) with mic permission policy
- [ ] **IT** — Wi‑Fi coverage verified at each bay position (signal test with tablet)
- [ ] **IT** — Merlin URL bookmarked or deployed as kiosk shortcut on tablets
- [ ] **TR** — Test tablet labeled “Merlin Bay #___” for training sessions

### Accounts & access

- [ ] **SM** — Technician accounts created (or seeded and personalized)
- [ ] **SM** — Service manager / admin account verified
- [ ] **SM** — Role permissions confirmed (technicians vs managers)
- [ ] **SM** — Escalation contact list posted in service drive (IT + SM phone/email)

### Training & documentation

- [ ] **SM** — [Technician Quick Start](./Technician-Quick-Start.md) printed or pinned in service lounge
- [ ] **TR** — [Training Outline](./Training-Outline.md) reviewed; session scheduled
- [ ] **TR** — Training tablets charged and logged in before session
- [ ] **SM** — Template library seeded with 3–5 common dealership story patterns (optional)

### Communication (internal)

- [ ] **FO** — Go-live date announced to service leadership
- [ ] **SM** — Technicians notified: what Merlin does, what it does **not** do (no fabricated tests)
- [ ] **SM** — Warranty administrator briefed on PDF export and CDK paste workflow
- [ ] **IT** — Maintenance window procedure shared with SM (how to pause AI if needed)

### Pre-rollout sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| IT | | | |
| Service Manager | | | |
| Fixed Ops Director | | | |

---

## Phase 2 — Deployment Day

*Go-live day — typically a Tuesday–Thursday morning before peak RO volume.*

### Morning — IT cutover (before shop opens)

- [ ] **IT** — Confirm `MERLIN_MAINTENANCE_MODE` is **off**
- [ ] **IT** — Final deploy from approved `main` commit
- [ ] **IT** — `npm run validate:pre-rollout` with `MERLIN_BASE_URL` — all critical checks pass
- [ ] **IT** — `/api/health` spot check from outside dealership network
- [ ] **IT** — UI footer shows correct version, commit, build date on tablet
- [ ] **SM** — Maintenance banner **not** visible

### Morning — Smoke test (IT + SM, 15 minutes)

- [ ] **SM** — Log in as technician on bay tablet
- [ ] **SM** — Open test RO (or training RO); navigate to a repair line
- [ ] **TR** — Voice: tap-to-toggle dictation into technician notes
- [ ] **TR** — Voice: push-to-talk dictation in noisy bay (or simulated noise)
- [ ] **SM** — Generate warranty story — completes without timeout
- [ ] **SM** — Review with AI — quality panel loads
- [ ] **SM** — Copy for CDK — paste succeeds
- [ ] **SM** — Download PDF — file opens correctly
- [ ] **IT** — Force Wi‑Fi off briefly — manual typing still works; offline banner appears

### Midday — Technician training session

- [ ] **TR** — 30–45 minute session per [Training Outline](./Training-Outline.md)
- [ ] **TR** — Every attending technician completes hands-on voice exercise
- [ ] **TR** — Every attending technician generates and edits one practice story
- [ ] **TR** — Trainer checklist completed (see Training Outline appendix)
- [ ] **SM** — Quick Start guides distributed to technicians who missed session

### Afternoon — Supervised live use

- [ ] **SM** — First 3 live warranty lines completed with Merlin (SM reviews stories)
- [ ] **TR** — Floor support available for voice / login questions
- [ ] **IT** — Monitor `/api/health` during first 4 hours
- [ ] **SM** — Collect technician feedback (voice, speed, story quality)

### Communication (go-live)

- [ ] **SM** — “Merlin is live” message to service team with Quick Start link
- [ ] **SM** — Reminder: document actual findings; edit AI drafts before submission
- [ ] **IT** — IT contact shared for outages (not for story content questions)

### Deployment day sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| IT | | | |
| Service Manager | | | |
| Lead Trainer | | | |

---

## Phase 3 — Post-Rollout Verification

*Complete within 5 business days of go-live.*

### Technical verification

- [ ] **IT** — `/api/health` stable for 5 consecutive days (no `"error"` status)
- [ ] **IT** — No unresolved CSP or authentication errors in production logs
- [ ] **IT** — Database connection latency acceptable (< 2s on health check)
- [ ] **IT** — Rate limiting verified under normal shop volume (no false lockouts)
- [ ] **SM** — Audit log reviewed — generation and export events recording correctly
- [ ] **SM** — No audit chain integrity warnings

### User adoption

- [ ] **SM** — ≥ 80% of warranty lines use Merlin for story draft (target by day 5)
- [ ] **SM** — Technician survey: voice usability, story quality, time saved
- [ ] **TR** — Refresher session scheduled for technicians who missed day-one training
- [ ] **SM** — Top 3 technician pain points documented and shared with FO

### Process integration

- [ ] **SM** — CDK paste workflow confirmed with warranty administrator
- [ ] **SM** — PDF export workflow confirmed for records / submissions
- [ ] **SM** — Template library has ≥ 3 dealership-specific templates (if applicable)
- [ ] **FO** — Rollout retrospective scheduled with IT + SM

### Multi-dealership rollout (group operations)

*For dealer groups rolling out location by location:*

- [ ] **FO** — Standardized `.env` template shared across locations (unique secrets per site)
- [ ] **FO** — Lessons learned from Location 1 applied to Location 2+ checklist
- [ ] **IT** — Per-location health monitoring dashboard or runbook
- [ ] **FO** — Group-wide training materials version-pinned to Merlin `version` in footer

### Post-rollout sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| IT | | | |
| Service Manager | | | |
| Fixed Ops Director | | | |

---

## Rollout status summary (per dealership)

| Dealership | Phase 1 complete | Go-live date | Phase 3 complete | Notes |
|------------|------------------|--------------|------------------|-------|
| | ☐ | | ☐ | |
| | ☐ | | ☐ | |
| | ☐ | | ☐ | |

---

## Related documents

| Document | Link |
|----------|------|
| **Master Rollout Document** | [Master-Rollout-Document.md](./Master-Rollout-Document.md) |
| Go-Live Summary | [Go-Live-Summary.md](./Go-Live-Summary.md) |
| Go-Live Checklist (final go/no-go) | [Go-Live-Checklist.md](./Go-Live-Checklist.md) |
| Go-Live Email Template | [Go-Live-Email-Template.md](./Go-Live-Email-Template.md) |
| Support Playbook | [Support-Playbook.md](./Support-Playbook.md) |
| Technician Quick Start | [Technician-Quick-Start.md](./Technician-Quick-Start.md) |
| Admin Setup Guide | [Admin-Setup-Guide.md](./Admin-Setup-Guide.md) |
| Training Outline | [Training-Outline.md](./Training-Outline.md) |

---

*Merlin — Mercedes-Benz Warranty Story Generator · Rollout Checklist*